import {
  appendTableRow, clearTable, closeDialog, formatKes, friendlyDbError, openDialog,
  requireAdministrator, setButtonBusy, setFormMessage, setText, showToast, state,
} from './core.js';
import { mountInventoryUi } from './inventory-template.js';

let inventoryItems = new Map();

const relation = (value) => Array.isArray(value) ? value[0] : value;
const number = (value) => Number(value || 0);
const display = (value) => String(value || '—').replaceAll('_', ' ');

function option(label, value = '') {
  return new Option(label, value);
}

function createAssetCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LT-${date}-${suffix}`;
}

function statusBadge(value) {
  const badge = document.createElement('span');
  badge.className = `inventory-status ${value}`;
  badge.textContent = display(value);
  return badge;
}

async function loadOptions() {
  const [categories, suppliers] = await Promise.all([
    state.client.from('inventory_categories').select('id, name').order('name'),
    state.client.from('inventory_suppliers').select('id, name, active').eq('active', true).order('name'),
  ]);
  if (categories.error) throw categories.error;
  if (suppliers.error) throw suppliers.error;
  const category = document.querySelector('#inventory-category');
  const supplier = document.querySelector('#inventory-supplier');
  const stockSupplier = document.querySelector('#stock-supplier');
  category.replaceChildren(option('Uncategorised'));
  supplier.replaceChildren(option('No supplier recorded'));
  stockSupplier.replaceChildren(option('No supplier recorded'));
  (categories.data || []).forEach((entry) => category.append(option(entry.name, entry.id)));
  (suppliers.data || []).forEach((entry) => {
    supplier.append(option(entry.name, entry.id));
    stockSupplier.append(option(entry.name, entry.id));
  });
}

function addItemRow(item) {
  const category = relation(item.inventory_categories);
  const supplier = relation(item.inventory_suppliers);
  const rowActions = document.createElement('div');
  rowActions.className = 'button-row';
  ['Stock', 'Edit'].forEach((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.dataset.inventoryAction = label.toLowerCase();
    button.dataset.inventoryId = item.id;
    button.textContent = label;
    rowActions.append(button);
  });
  appendTableRow('inventory-table', [
    `${item.name}\n${item.asset_code}`,
    category?.name || 'Other',
    `${number(item.quantity_on_hand)} ${item.unit_of_measure}`,
    formatKes(number(item.quantity_on_hand) * number(item.unit_cost)),
    `${display(item.item_condition)} · ${display(item.operational_status)}`,
    item.location || '—',
    supplier?.name || '—',
    rowActions,
  ]);
}

function addMovementRow(movement) {
  const item = relation(movement.inventory_items);
  const supplier = relation(movement.inventory_suppliers);
  const direction = number(movement.quantity_change) > 0 ? '+' : '−';
  appendTableRow('inventory-movements-table', [
    new Date(movement.occurred_at).toLocaleDateString(),
    item ? `${item.name} (${item.asset_code})` : 'Inventory item',
    display(movement.movement_type),
    `${direction}${Math.abs(number(movement.quantity_change))} ${item?.unit_of_measure || ''}`,
    supplier?.name || '—',
    movement.delivery_reference || '—',
  ]);
}

export async function loadInventory() {
  if (!requireAdministrator()) return;
  setText('inventory-message', 'Loading asset register…');
  try {
    const [itemsResult, movementsResult, suppliersResult] = await Promise.all([
      state.client.from('inventory_items')
        .select('id, asset_code, name, category_id, supplier_id, unit_of_measure, quantity_on_hand, reorder_level, unit_cost, item_condition, operational_status, location, serial_number, acquired_on, purchase_reference, notes, inventory_categories(name), inventory_suppliers(name)')
        .order('name').limit(500),
      state.client.from('inventory_movements')
        .select('id, item_id, supplier_id, movement_type, quantity_change, unit_cost, delivery_reference, notes, occurred_at, inventory_items(name, asset_code, unit_of_measure), inventory_suppliers(name)')
        .order('occurred_at', { ascending: false }).limit(40),
      state.client.from('inventory_suppliers').select('id', { count: 'exact', head: true }),
    ]);
    [itemsResult, movementsResult, suppliersResult].forEach((result) => { if (result.error) throw result.error; });
    const items = itemsResult.data || [];
    inventoryItems = new Map(items.map((item) => [item.id, item]));
    const totalUnits = items.reduce((sum, item) => sum + number(item.quantity_on_hand), 0);
    const assetValue = items.reduce((sum, item) => sum + (number(item.quantity_on_hand) * number(item.unit_cost)), 0);
    const lowStock = items.filter((item) => number(item.reorder_level) > 0 && number(item.quantity_on_hand) <= number(item.reorder_level)).length;
    setText('inventory-asset-count', `${items.length} asset record${items.length === 1 ? '' : 's'}`);
    setText('inventory-total-units', `${totalUnits.toLocaleString()} units`);
    setText('inventory-asset-value', formatKes(assetValue));
    setText('inventory-low-stock', `${lowStock} need${lowStock === 1 ? 's' : ''} attention`);
    setText('inventory-supplier-count', `${suppliersResult.count || 0} supplier${Number(suppliersResult.count || 0) === 1 ? '' : 's'}`);
    clearTable('inventory-table');
    items.forEach(addItemRow);
    clearTable('inventory-movements-table');
    (movementsResult.data || []).forEach(addMovementRow);
    setText('inventory-message', items.length ? 'Asset values are calculated from the latest recorded unit cost.' : 'No assets recorded yet. Add the first school asset or supply.');
  } catch (error) {
    setText('inventory-message', friendlyDbError(error, 'Unable to load inventory. Apply Phase 12, then try again.'));
  }
}

async function openItemForm(itemId = null) {
  if (!requireAdministrator()) return;
  try {
    await loadOptions();
    const form = document.querySelector('#inventory-form');
    form.reset();
    const item = itemId ? inventoryItems.get(itemId) : null;
    document.querySelector('#inventory-item-id').value = item?.id || '';
    document.querySelector('#inventory-modal-title').textContent = item ? 'Edit inventory item' : 'Add inventory item';
    document.querySelector('#inventory-code').value = item?.asset_code || createAssetCode();
    document.querySelector('#inventory-name').value = item?.name || '';
    document.querySelector('#inventory-category').value = item?.category_id || '';
    document.querySelector('#inventory-supplier').value = item?.supplier_id || '';
    document.querySelector('#inventory-unit').value = item?.unit_of_measure || 'each';
    document.querySelector('#inventory-unit-cost').value = item?.unit_cost ?? 0;
    document.querySelector('#inventory-reorder-level').value = item?.reorder_level ?? 0;
    document.querySelector('#inventory-condition').value = item?.item_condition || 'good';
    document.querySelector('#inventory-status').value = item?.operational_status || 'active';
    document.querySelector('#inventory-location').value = item?.location || '';
    document.querySelector('#inventory-serial-number').value = item?.serial_number || '';
    document.querySelector('#inventory-acquired-on').value = item?.acquired_on || '';
    document.querySelector('#inventory-purchase-reference').value = item?.purchase_reference || '';
    document.querySelector('#inventory-notes').value = item?.notes || '';
    const quantity = document.querySelector('#inventory-opening-quantity');
    quantity.value = 0;
    quantity.disabled = Boolean(item);
    document.querySelector('#inventory-opening-help').textContent = item ? `Current stock: ${number(item.quantity_on_hand)} ${item.unit_of_measure}. Use “Stock” to record a change.` : 'Opening quantity is recorded in the supply history.';
    setFormMessage('inventory-form-message');
    openDialog('inventory-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare the inventory form.'));
  }
}

async function saveItem(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-inventory-item');
  setButtonBusy(button, true, 'Saving…', 'Save item');
  setFormMessage('inventory-form-message');
  try {
    const itemId = document.querySelector('#inventory-item-id').value;
    const payload = {
      asset_code: document.querySelector('#inventory-code').value.trim(),
      name: document.querySelector('#inventory-name').value.trim(),
      category_id: document.querySelector('#inventory-category').value || null,
      supplier_id: document.querySelector('#inventory-supplier').value || null,
      unit_of_measure: document.querySelector('#inventory-unit').value.trim(),
      unit_cost: number(document.querySelector('#inventory-unit-cost').value),
      reorder_level: number(document.querySelector('#inventory-reorder-level').value),
      item_condition: document.querySelector('#inventory-condition').value,
      operational_status: document.querySelector('#inventory-status').value,
      location: document.querySelector('#inventory-location').value.trim() || null,
      serial_number: document.querySelector('#inventory-serial-number').value.trim() || null,
      acquired_on: document.querySelector('#inventory-acquired-on').value || null,
      purchase_reference: document.querySelector('#inventory-purchase-reference').value.trim() || null,
      notes: document.querySelector('#inventory-notes').value.trim() || null,
    };
    let item;
    if (itemId) {
      const { data, error } = await state.client.from('inventory_items').update(payload).eq('id', itemId).select('id').single();
      if (error) throw error;
      item = data;
    } else {
      payload.created_by = state.user.id;
      const { data, error } = await state.client.from('inventory_items').insert(payload).select('id').single();
      if (error) throw error;
      item = data;
      const openingQuantity = number(document.querySelector('#inventory-opening-quantity').value);
      if (openingQuantity > 0) {
        const { error: movementError } = await state.client.from('inventory_movements').insert({
          item_id: item.id, movement_type: 'opening_balance', quantity_change: openingQuantity,
          unit_cost: payload.unit_cost, notes: 'Opening inventory balance', recorded_by: state.user.id,
        });
        if (movementError) throw movementError;
      }
    }
    closeDialog('inventory-modal');
    showToast(itemId ? 'Inventory item updated.' : 'Inventory item added.');
    await loadInventory();
  } catch (error) {
    setFormMessage('inventory-form-message', friendlyDbError(error, 'Could not save this inventory item.'));
  } finally {
    setButtonBusy(button, false, '', 'Save item');
  }
}

async function openStockForm(itemId) {
  if (!requireAdministrator()) return;
  const item = inventoryItems.get(itemId);
  if (!item) return showToast('That inventory item is no longer available. Refresh and try again.');
  try {
    await loadOptions();
    document.querySelector('#stock-form').reset();
    document.querySelector('#stock-item-id').value = item.id;
    setText('stock-item-name', `${item.name} · currently ${number(item.quantity_on_hand)} ${item.unit_of_measure}`);
    document.querySelector('#stock-supplier').value = item.supplier_id || '';
    document.querySelector('#stock-unit-cost').value = item.unit_cost ?? 0;
    document.querySelector('#stock-quantity').value = 1;
    document.querySelector('#stock-type').value = 'receipt';
    setFormMessage('stock-form-message');
    openDialog('stock-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare the stock form.'));
  }
}

async function saveStock(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-stock');
  setButtonBusy(button, true, 'Saving…', 'Record stock');
  setFormMessage('stock-form-message');
  try {
    const itemId = document.querySelector('#stock-item-id').value;
    const type = document.querySelector('#stock-type').value;
    const quantity = number(document.querySelector('#stock-quantity').value);
    const quantityChange = type === 'issue' ? -quantity : quantity;
    const unitCost = number(document.querySelector('#stock-unit-cost').value);
    const { error } = await state.client.from('inventory_movements').insert({
      item_id: itemId,
      supplier_id: document.querySelector('#stock-supplier').value || null,
      movement_type: type,
      quantity_change: quantityChange,
      unit_cost: unitCost,
      delivery_reference: document.querySelector('#stock-reference').value.trim() || null,
      notes: document.querySelector('#stock-notes').value.trim() || null,
      recorded_by: state.user.id,
    });
    if (error) throw error;
    if (type === 'receipt') {
      const { error: priceError } = await state.client.from('inventory_items').update({ unit_cost: unitCost }).eq('id', itemId);
      if (priceError) throw priceError;
    }
    closeDialog('stock-modal');
    showToast(type === 'receipt' ? 'Supply received and stock updated.' : 'Stock issue recorded.');
    await loadInventory();
  } catch (error) {
    setFormMessage('stock-form-message', error?.message || friendlyDbError(error, 'Could not update stock.'));
  } finally {
    setButtonBusy(button, false, '', 'Record stock');
  }
}

function openSupplierForm() {
  if (!requireAdministrator()) return;
  document.querySelector('#supplier-form').reset();
  setFormMessage('supplier-form-message');
  openDialog('supplier-modal');
}

async function saveSupplier(event) {
  event.preventDefault();
  const button = document.querySelector('#save-supplier');
  setButtonBusy(button, true, 'Saving…', 'Save supplier');
  setFormMessage('supplier-form-message');
  try {
    const { error } = await state.client.from('inventory_suppliers').insert({
      name: document.querySelector('#supplier-name').value.trim(),
      contact_person: document.querySelector('#supplier-contact').value.trim() || null,
      phone: document.querySelector('#supplier-phone').value.trim() || null,
      email: document.querySelector('#supplier-email').value.trim() || null,
      address: document.querySelector('#supplier-address').value.trim() || null,
    });
    if (error) throw error;
    closeDialog('supplier-modal');
    showToast('Supplier saved.');
    await loadInventory();
  } catch (error) {
    setFormMessage('supplier-form-message', friendlyDbError(error, 'Could not save this supplier.'));
  } finally {
    setButtonBusy(button, false, '', 'Save supplier');
  }
}

export function initInventory() {
  mountInventoryUi();
  document.querySelector('#add-inventory-item').addEventListener('click', () => openItemForm());
  document.querySelector('#add-inventory-supplier').addEventListener('click', openSupplierForm);
  document.querySelector('#inventory-form').addEventListener('submit', saveItem);
  document.querySelector('#stock-form').addEventListener('submit', saveStock);
  document.querySelector('#supplier-form').addEventListener('submit', saveSupplier);
  document.querySelector('#inventory-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-inventory-action]');
    if (!button) return;
    if (button.dataset.inventoryAction === 'stock') openStockForm(button.dataset.inventoryId);
    if (button.dataset.inventoryAction === 'edit') openItemForm(button.dataset.inventoryId);
  });
}
