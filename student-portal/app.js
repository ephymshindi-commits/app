const dialog = document.querySelector('#coming-soon-modal');
document.querySelectorAll('[data-coming-soon]').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
document.querySelector('#year').textContent = new Date().getFullYear();
