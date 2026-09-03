param(
  [Parameter(Mandatory = $true)]
  [string]$SupabasePat
)

$ErrorActionPreference = 'Stop'
$projectRef = 'xagmipuvbvzyqpzxkqbl'
$projectUrl = "https://$projectRef.supabase.co"
$managementUrl = "https://api.supabase.com/v1/projects/$projectRef"
$marker = "SYSTEM-TEST-$((Get-Date).ToString('yyyyMMddHHmmss'))"
$results = [System.Collections.Generic.List[object]]::new()
$temporaryAdminId = $null

function Add-Result([string]$Form, [string]$Status, [string]$Detail) {
  $results.Add([PSCustomObject]@{ form = $Form; status = $Status; detail = $Detail })
}

function Invoke-ManagementQuery([string]$Query) {
  $headers = @{ Authorization = "Bearer $SupabasePat"; 'Content-Type' = 'application/json' }
  Invoke-RestMethod -Method Post -Uri "$managementUrl/database/query" -Headers $headers -Body (@{ query = $Query } | ConvertTo-Json -Compress)
}

try {
  $keys = Invoke-RestMethod -Method Get -Uri "$managementUrl/api-keys" -Headers @{ Authorization = "Bearer $SupabasePat" }
  $serviceKey = ($keys | Where-Object { $_.name -eq 'service_role' -and $_.type -eq 'legacy' }).api_key
  $publishableKey = ($keys | Where-Object { $_.name -eq 'default' -and $_.type -eq 'publishable' }).api_key
  if (-not $serviceKey -or -not $publishableKey) { throw 'The project API keys are unavailable.' }

  $temporaryAdminEmail = "form.qa.$($marker.ToLower())@example.test"
  $temporaryPassword = "Qa!$marker`a9"
  $serviceHeaders = @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey"; 'Content-Type' = 'application/json' }
  $temporaryAdmin = Invoke-RestMethod -Method Post -Uri "$projectUrl/auth/v1/admin/users" -Headers $serviceHeaders -Body (@{ email = $temporaryAdminEmail; password = $temporaryPassword; email_confirm = $true; user_metadata = @{ full_name = 'Form Readiness Administrator' } } | ConvertTo-Json -Compress)
  $temporaryAdminId = $temporaryAdmin.id
  Invoke-ManagementQuery "insert into public.profiles (id, full_name, email, role) values ('$temporaryAdminId', 'Form Readiness Administrator', '$temporaryAdminEmail', 'administrator')" | Out-Null
  $session = Invoke-RestMethod -Method Post -Uri "$projectUrl/auth/v1/token?grant_type=password" -Headers @{ apikey = $publishableKey; 'Content-Type' = 'application/json' } -Body (@{ email = $temporaryAdminEmail; password = $temporaryPassword } | ConvertTo-Json -Compress)
  if (-not $session.access_token) { throw 'The temporary administrator session could not be created.' }

  $appHeaders = @{ apikey = $publishableKey; Authorization = "Bearer $($session.access_token)"; 'Content-Type' = 'application/json'; Prefer = 'return=representation' }
  $upsertHeaders = @{ apikey = $publishableKey; Authorization = "Bearer $($session.access_token)"; 'Content-Type' = 'application/json'; Prefer = 'return=representation,resolution=merge-duplicates' }
  function Invoke-AppGet([string]$Path) { Invoke-RestMethod -Method Get -Uri "$projectUrl/rest/v1/$Path" -Headers $appHeaders }
  function Invoke-AppPost([string]$Table, $Body, [string]$Query = '') { Invoke-RestMethod -Method Post -Uri "$projectUrl/rest/v1/$Table$Query" -Headers $appHeaders -Body ($Body | ConvertTo-Json -Depth 8 -Compress) }
  function Invoke-AppUpsert([string]$Table, $Body, [string]$Query = '') { Invoke-RestMethod -Method Post -Uri "$projectUrl/rest/v1/$Table$Query" -Headers $upsertHeaders -Body ($Body | ConvertTo-Json -Depth 8 -Compress) }
  function Invoke-AppPatch([string]$Table, [string]$Query, $Body) { Invoke-RestMethod -Method Patch -Uri "$projectUrl/rest/v1/$Table$Query" -Headers $appHeaders -Body ($Body | ConvertTo-Json -Depth 8 -Compress) }

  $department = (Invoke-AppGet 'departments?select=id&order=name.asc&limit=1')[0]
  $trainer = (Invoke-AppGet 'profiles?select=id&role=eq.trainer&order=full_name.asc&limit=1')[0]
  if (-not $department -or -not $trainer) { throw 'A department and trainer are required for the readiness run.' }

  $programme = (Invoke-AppPost 'programmes' @{ name = "[$marker] Form Readiness Programme"; code = "QA$($marker.Substring($marker.Length - 6))"; department_id = $department.id; duration_years = 1; active = $true })[0]
  Add-Result 'Academic programme' 'saved' $programme.code

  $academicYear = (Invoke-AppPost 'academic_years' @{ name = "[$marker] Academic Year"; starts_on = '2027-01-05'; ends_on = '2027-12-18'; active = $false })[0]
  Add-Result 'Academic year' 'saved' $academicYear.name

  $semester = (Invoke-AppPost 'semesters' @{ academic_year_id = $academicYear.id; name = 'Semester 1'; starts_on = '2027-01-05'; ends_on = '2027-05-30' })[0]
  Add-Result 'Semester' 'saved' $semester.name

  $unit = (Invoke-AppPost 'units' @{ programme_id = $programme.id; name = "[$marker] Applied Systems"; code = "U$($marker.Substring($marker.Length - 8))"; year_of_study = 1; semester_number = 1; credit_hours = 3 })[0]
  Add-Result 'Academic unit' 'saved' $unit.code

  $fee = (Invoke-AppUpsert 'fee_structures' @{ programme_id = $programme.id; academic_year_id = $academicYear.id; year_of_study = 1; amount = 18500 } '?on_conflict=programme_id,academic_year_id,year_of_study')[0]
  Add-Result 'Programme fee structure' 'saved' "KES $($fee.amount)"

  $student = (Invoke-AppPost 'students' @{ first_name = 'Form'; last_name = "Tester $marker"; personal_email = "student.$($marker.ToLower())@example.test"; phone = '+254700999001'; programme_id = $programme.id; status = 'active'; admitted_at = '2027-01-05'; next_of_kin_name = 'Test Guardian'; next_of_kin_relationship = 'Guardian'; next_of_kin_phone = '+254700999002' })[0]
  Add-Result 'Student admission' 'saved' $student.id

  $invoice = (Invoke-AppPost 'invoices' @{ student_id = $student.id; invoice_number = "FEE-$marker"; amount = 18500; due_on = '2027-02-15'; status = 'issued'; issued_at = (Get-Date).ToUniversalTime().ToString('o') })[0]
  Add-Result 'Fee charge' 'saved' $invoice.invoice_number

  $payment = (Invoke-AppPost 'payments' @{ student_id = $student.id; invoice_id = $invoice.id; receipt_number = "RCT-$marker"; amount = 5000; method = 'M-PESA'; reference = "TEST-$marker"; recorded_by = $temporaryAdminId })[0]
  Add-Result 'Payment receipt' 'saved' $payment.receipt_number

  $course = (Invoke-AppPost 'learning_courses' @{ title = "[$marker] Learning Space"; unit_id = $unit.id; semester_id = $semester.id; trainer_id = $trainer.id; visibility = 'draft'; description = 'System form-readiness record.' })[0]
  Add-Result 'Learning course' 'saved' $course.id

  Invoke-AppPost 'course_memberships' @{ course_id = $course.id; student_id = $student.id } | Out-Null
  Add-Result 'Course enrolment' 'saved' $student.id

  $slot = (Invoke-AppPost 'timetable_slots' @{ unit_id = $unit.id; semester_id = $semester.id; trainer_id = $trainer.id; programme_id = $programme.id; day_of_week = 6; starts_at = '14:00'; ends_at = '16:00'; room_name = "[$marker] Room"; delivery_mode = 'hybrid' })[0]
  Add-Result 'Timetable slot' 'saved' $slot.id

  $attendanceSession = (Invoke-AppPost 'attendance_sessions' @{ unit_id = $unit.id; semester_id = $semester.id; held_at = '2027-01-10T08:00:00Z'; recorded_by = $temporaryAdminId })[0]
  Invoke-AppPost 'attendance_records' @(@{ session_id = $attendanceSession.id; student_id = $student.id; status = 'present' }) | Out-Null
  Add-Result 'Attendance register' 'saved' $attendanceSession.id

  $result = (Invoke-AppPost 'unit_results' @{ student_id = $student.id; unit_id = $unit.id; semester_id = $semester.id; cat_score = 28; exam_score = 55; grade = 'A'; status = 'draft'; entered_by = $temporaryAdminId })[0]
  Add-Result 'Result entry' 'saved' "total $($result.total_score)"

  $resource = (Invoke-AppPost 'library_resources' @{ title = "[$marker] Digital Resource"; author = 'System quality check'; resource_type = 'repository'; subject = 'Form readiness'; external_url = 'https://example.com/library-test'; access_level = 'institution'; created_by = $temporaryAdminId })[0]
  Add-Result 'Library resource' 'saved' $resource.id

  $announcement = (Invoke-AppPost 'announcements' @{ title = "[$marker] Form readiness record"; message = 'This is a clearly labelled system test record used to verify portal data saving.'; audience = 'staff'; published = $true; published_at = (Get-Date).ToUniversalTime().ToString('o'); created_by = $temporaryAdminId })[0]
  Add-Result 'Announcement' 'saved' $announcement.id

  $assessment = (Invoke-AppPost 'online_assessments' @{ course_id = $course.id; title = "[$marker] Knowledge Check"; instructions = 'System form-readiness assessment.'; kind = 'quiz'; opens_at = '2027-01-10T08:00:00Z'; closes_at = '2027-01-17T18:00:00Z'; duration_minutes = 30; attempt_limit = 1; published = $false; created_by = $temporaryAdminId })[0]
  Add-Result 'Online assessment' 'saved' $assessment.id

  $bank = (Invoke-AppPost 'question_banks' @{ unit_id = $unit.id; title = "[$marker] Knowledge Check question bank"; owner_id = $temporaryAdminId })[0]
  $question = (Invoke-AppPost 'questions' @{ question_bank_id = $bank.id; prompt = 'Is this a form-readiness test?'; kind = 'multiple_choice'; marks = 1 })[0]
  Invoke-AppPost 'question_options' @(@{ question_id = $question.id; option_text = 'Yes'; position = 1; is_correct = $true }, @{ question_id = $question.id; option_text = 'No'; position = 2; is_correct = $false }) | Out-Null
  Invoke-AppPost 'assessment_questions' @{ assessment_id = $assessment.id; question_id = $question.id; position = 1; marks = 1 } | Out-Null
  Add-Result 'Assessment question' 'saved' $question.id

  $sessionRecord = (Invoke-AppPost 'virtual_sessions' @{ course_id = $course.id; title = "[$marker] Live Class"; starts_at = '2027-01-12T09:00:00Z'; ends_at = '2027-01-12T10:00:00Z'; meeting_url = "agora://qa-$marker"; created_by = $temporaryAdminId })[0]
  Add-Result 'Live class schedule' 'saved' $sessionRecord.id

  $supplier = (Invoke-AppPost 'inventory_suppliers' @{ name = "[$marker] Test Supplier"; contact_person = 'System QA'; phone = '+254700999003'; email = "supplier.$($marker.ToLower())@example.test"; address = 'Quality assurance record' })[0]
  Add-Result 'Inventory supplier' 'saved' $supplier.id

  $item = (Invoke-AppPost 'inventory_items' @{ asset_code = "AST-$marker"; name = "[$marker] Test Asset"; supplier_id = $supplier.id; unit_of_measure = 'each'; unit_cost = 1200; reorder_level = 2; item_condition = 'new'; operational_status = 'active'; location = 'System QA store'; purchase_reference = "PO-$marker"; notes = 'System form-readiness record.'; created_by = $temporaryAdminId })[0]
  Invoke-AppPost 'inventory_movements' @{ item_id = $item.id; movement_type = 'opening_balance'; quantity_change = 5; unit_cost = 1200; notes = 'Opening inventory balance'; recorded_by = $temporaryAdminId } | Out-Null
  Invoke-AppPost 'inventory_movements' @{ item_id = $item.id; supplier_id = $supplier.id; movement_type = 'receipt'; quantity_change = 2; unit_cost = 1250; delivery_reference = "DN-$marker"; notes = 'Supply received'; recorded_by = $temporaryAdminId } | Out-Null
  Invoke-AppPatch 'inventory_items' "?id=eq.$($item.id)" @{ unit_cost = 1250 } | Out-Null
  Add-Result 'Inventory item and stock movement' 'saved' $item.id

  $settings = (Invoke-AppGet 'institution_settings?select=institution_name,academic_year_label,support_email&id=eq.true')[0]
  Invoke-AppUpsert 'institution_settings' @{ id = $true; institution_name = $settings.institution_name; academic_year_label = $settings.academic_year_label; support_email = $settings.support_email; updated_by = $temporaryAdminId } '?on_conflict=id' | Out-Null
  Add-Result 'Institution settings' 'saved' 'Existing values preserved'

  $workerEmail = "worker.$($marker.ToLower())@example.com"
  $workerBody = @{ fullName = "[$marker] Test Trainer"; email = $workerEmail; temporaryPassword = "Qa!Worker$($marker.Substring($marker.Length - 8))"; employeeNumber = "QA/$($marker.Substring($marker.Length - 6))"; jobTitle = 'Quality Assurance Trainer'; departmentId = $department.id; phone = '+254700999004'; role = 'trainer'; employmentStatus = 'active' } | ConvertTo-Json -Compress
  $worker = Invoke-RestMethod -Method Post -Uri "$projectUrl/functions/v1/admin-create-worker" -Headers @{ apikey = $publishableKey; Authorization = "Bearer $($session.access_token)"; 'Content-Type' = 'application/json' } -Body $workerBody
  if ($worker.error -or -not $worker.worker) { throw ($worker.error ?? 'The worker form endpoint did not return a worker record.') }
  Add-Result 'Worker provisioning' 'saved' $worker.worker.employee_number

  $verified = Invoke-ManagementQuery "select (select count(*) from public.students where id = '$($student.id)') as student_count, (select count(*) from public.payments where id = '$($payment.id)') as payment_count, (select quantity_on_hand from public.inventory_items where id = '$($item.id)') as stock_on_hand, (select count(*) from public.assessment_questions where assessment_id = '$($assessment.id)') as assessment_question_count"
  if ([int]$verified.student_count -ne 1 -or [int]$verified.payment_count -ne 1 -or [decimal]$verified.stock_on_hand -ne 7 -or [int]$verified.assessment_question_count -ne 1) { throw 'A saved record did not pass its dependent-data verification.' }
  Add-Result 'Dependent record checks' 'verified' 'Student, payment, stock and assessment links are valid'

  $results | ConvertTo-Json -Compress
} finally {
  if ($temporaryAdminId) {
    try {
      $cleanupKeys = Invoke-RestMethod -Method Get -Uri "$managementUrl/api-keys" -Headers @{ Authorization = "Bearer $SupabasePat" }
      $cleanupServiceKey = ($cleanupKeys | Where-Object { $_.name -eq 'service_role' -and $_.type -eq 'legacy' }).api_key
      Invoke-RestMethod -Method Delete -Uri "$projectUrl/auth/v1/admin/users/$temporaryAdminId" -Headers @{ apikey = $cleanupServiceKey; Authorization = "Bearer $cleanupServiceKey" } | Out-Null
    } catch {}
  }
}
