document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const batchesContainer = document.getElementById('batches-container');
    const currentDateDisplay = document.getElementById('current-date-display');
    const toastContainer = document.getElementById('toast-container');
    
    const finalSubmitBtn = document.getElementById('final-submit-btn');

    // Modals
    const addStudentModal = document.getElementById('add-student-modal');
    const settingsModal = document.getElementById('settings-modal');
    const confirmCompleteModal = document.getElementById('confirm-complete-modal');
    const confirmCompleteBtn = document.getElementById('confirm-complete-btn');
    
    // Forms
    const addStudentForm = document.getElementById('add-student-form');
    const configForm = document.getElementById('config-form');

    // --- State Management ---
    let students = JSON.parse(localStorage.getItem('students')) || [];
    let attendanceRecords = JSON.parse(localStorage.getItem('attendance')) || [];
    let googleFormConfig = JSON.parse(localStorage.getItem('googleFormConfig')) || null;
    let studentIdToDelete = null; // Temp holder for complete action

    // Daily Reset Key (YYYY-MM-DD)
    const todayStr = new Date().toLocaleDateString('en-CA');

    // --- Initialization ---
    function init() {
        // Display Current Date
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        currentDateDisplay.textContent = new Date().toLocaleDateString('en-US', options);

        if (googleFormConfig) prefillConfigForm();
        renderBatches();
    }

    // --- Modal Logic ---
    const toggleModal = (modal, show) => {
        if (show) modal.classList.add('active');
        else modal.classList.remove('active');
    };

    document.getElementById('open-add-student-btn').addEventListener('click', () => toggleModal(addStudentModal, true));
    document.getElementById('settings-btn').addEventListener('click', () => toggleModal(settingsModal, true));

    // Global Close buttons
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            toggleModal(e.target.closest('.modal-overlay'), false);
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) toggleModal(overlay, false);
        });
    });

    // --- Settings Configuration ---
    configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        let url = document.getElementById('config-url').value.trim().split('?')[0]; 
        
        googleFormConfig = {
            url: url,
            nameKey: document.getElementById('config-name-key').value.trim(),
            statusKey: document.getElementById('config-status-key').value.trim(),
            batchKey: document.getElementById('config-batch-key').value.trim()
        };

        localStorage.setItem('googleFormConfig', JSON.stringify(googleFormConfig));
        showToast('Configuration saved successfully!', 'success');
        toggleModal(settingsModal, false);
    });

    function prefillConfigForm() {
        if(!googleFormConfig) return;
        document.getElementById('config-url').value = googleFormConfig.url || '';
        document.getElementById('config-name-key').value = googleFormConfig.nameKey || '';
        document.getElementById('config-status-key').value = googleFormConfig.statusKey || '';
        document.getElementById('config-batch-key').value = googleFormConfig.batchKey || '';
    }

    // --- Add Student Logic ---
    addStudentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('new-student-name').value.trim();
        const batchInput = document.getElementById('new-batch').value.trim();

        if (!nameInput || !batchInput) return showToast('Please fill all fields', 'error');

        const isDuplicate = students.some(s => s.name.toLowerCase() === nameInput.toLowerCase() && s.batch === batchInput);
        if (isDuplicate) return showToast('Student already exists in this batch', 'error');

        students.push({ id: Date.now().toString(), name: nameInput, batch: batchInput });
        localStorage.setItem('students', JSON.stringify(students));

        showToast('Student added successfully!', 'success');
        addStudentForm.reset();
        toggleModal(addStudentModal, false);
        renderBatches();
    });

    // --- Core Attendance Check ---
    function getTodayRecord(studentId) {
        return attendanceRecords.find(r => r.studentId === studentId && r.date === todayStr);
    }

    // --- Complete Course (Delete Student) Logic ---
    confirmCompleteBtn.addEventListener('click', () => {
        if (!studentIdToDelete) return;

        // 1. Remove student from list
        students = students.filter(s => s.id !== studentIdToDelete);
        
        // 2. Remove all attendance history for this student
        attendanceRecords = attendanceRecords.filter(r => r.studentId !== studentIdToDelete);

        // 3. Save clean state to Local Storage
        localStorage.setItem('students', JSON.stringify(students));
        localStorage.setItem('attendance', JSON.stringify(attendanceRecords));

        showToast('Student completed and data removed.', 'success');
        
        // Reset and hide
        studentIdToDelete = null;
        toggleModal(confirmCompleteModal, false);
        
        // Re-render instantly - empty batches will auto-hide
        renderBatches(); 
    });


    // --- Render Batches & Students ---
    function renderBatches() {
        batchesContainer.innerHTML = '';

        if (students.length === 0) {
            batchesContainer.innerHTML = `
                <div class="empty-state card">
                    <i class="ph ph-users"></i>
                    <h3>No students found</h3>
                    <p>Add students to start taking attendance.</p>
                </div>
            `;
            return;
        }

        const grouped = students.reduce((acc, student) => {
            if (!acc[student.batch]) acc[student.batch] = [];
            acc[student.batch].push(student);
            return acc;
        }, {});

        const sortedBatches = Object.keys(grouped).sort();

        sortedBatches.forEach(batch => {
            const batchStudents = grouped[batch].sort((a, b) => a.name.localeCompare(b.name));
            
            const card = document.createElement('div');
            card.className = 'batch-card';
            
            let headerHTML = `
                <div class="batch-header">
                    <div class="batch-title">
                        <i class="ph-fill ph-clock"></i> ${batch}
                    </div>
                    <div class="batch-actions">
                        <button class="btn-small bulk-action" data-batch="${batch}" data-status="P">All Present</button>
                        <button class="btn-small bulk-action" data-batch="${batch}" data-status="O">All Off</button>
                        <button class="btn-small bulk-action" data-batch="${batch}" data-status="H">All Holiday</button>
                    </div>
                </div>
                <div class="student-list">
            `;

            let rowsHTML = '';
            batchStudents.forEach(student => {
                const record = getTodayRecord(student.id);
                const isLocked = !!record;
                const status = isLocked ? record.status : '';

                rowsHTML += `
                    <div class="student-row ${isLocked ? 'locked' : ''}" id="row-${student.id}">
                        <div class="student-info">
                            <i class="ph-fill ph-user-circle"></i> ${student.name}
                        </div>
                        <div class="row-actions">
                            <div class="attendance-toggles">
                                <label>
                                    <input type="radio" name="status-${student.id}" value="P" class="status-radio" data-id="${student.id}" data-batch="${batch}" data-name="${student.name}" ${status === 'P' ? 'checked' : ''} ${isLocked ? 'disabled' : ''}>
                                    <span class="toggle-btn">P</span>
                                </label>
                                <label>
                                    <input type="radio" name="status-${student.id}" value="A" class="status-radio" data-id="${student.id}" data-batch="${batch}" data-name="${student.name}" ${status === 'A' ? 'checked' : ''} ${isLocked ? 'disabled' : ''}>
                                    <span class="toggle-btn">A</span>
                                </label>
                                <label>
                                    <input type="radio" name="status-${student.id}" value="O" class="status-radio" data-id="${student.id}" data-batch="${batch}" data-name="${student.name}" ${status === 'O' ? 'checked' : ''} ${isLocked ? 'disabled' : ''}>
                                    <span class="toggle-btn">O</span>
                                </label>
                                <label>
                                    <input type="radio" name="status-${student.id}" value="H" class="status-radio" data-id="${student.id}" data-batch="${batch}" data-name="${student.name}" ${status === 'H' ? 'checked' : ''} ${isLocked ? 'disabled' : ''}>
                                    <span class="toggle-btn">H</span>
                                </label>
                            </div>
                            <button class="btn-complete trigger-complete" data-id="${student.id}">
                                <i class="ph-fill ph-graduation-cap"></i> Complete Course
                            </button>
                        </div>
                    </div>
                `;
            });

            card.innerHTML = headerHTML + rowsHTML + `</div>`;
            batchesContainer.appendChild(card);
        });

        // Attach Event Listeners to Radios
        document.querySelectorAll('.status-radio').forEach(radio => {
            radio.addEventListener('change', async (e) => {
                if(e.target.checked) {
                    const { id, batch, name } = e.target.dataset;
                    await markAttendance(id, name, batch, e.target.value, false);
                }
            });
        });

        // Attach Event Listeners to Bulk Actions
        document.querySelectorAll('.bulk-action').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const { batch, status } = e.target.dataset;
                await processBulkAction(batch, status);
            });
        });

        // Attach Event Listeners to Complete Course Buttons
        document.querySelectorAll('.trigger-complete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Read from current target to ensure we hit the button even if icon is clicked
                studentIdToDelete = e.currentTarget.dataset.id;
                toggleModal(confirmCompleteModal, true);
            });
        });
    }

    // --- Core Save & Sync Function ---
    async function markAttendance(studentId, studentName, batch, status, isBulk = false) {
        
        if (!googleFormConfig || !googleFormConfig.url || !googleFormConfig.nameKey || !googleFormConfig.statusKey || !googleFormConfig.batchKey) {
            showToast('Please configure Google Form first', 'error');
            toggleModal(settingsModal, true);
            renderBatches(); 
            return false;
        }

        let submitUrl = googleFormConfig.url.trim().split('?')[0];
        if (submitUrl.endsWith('/viewform')) {
            submitUrl = submitUrl.replace(/\/viewform$/, '/formResponse');
        } else if (!submitUrl.endsWith('/formResponse')) {
            submitUrl = submitUrl.replace(/\/+$/, '') + '/formResponse'; 
        }

        const payloadObj = {};
        payloadObj[googleFormConfig.nameKey] = studentName;
        payloadObj[googleFormConfig.statusKey] = status;
        payloadObj[googleFormConfig.batchKey] = batch;

        const payloadParams = new URLSearchParams(payloadObj);

        // Save Locally immediately
        const record = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            studentId,
            studentName,
            batch,
            status,
            date: todayStr,
            timestamp: new Date().toISOString()
        };
        attendanceRecords.push(record);
        localStorage.setItem('attendance', JSON.stringify(attendanceRecords));

        // Lock UI Row visually immediately
        const row = document.getElementById(`row-${studentId}`);
        if(row) {
            row.classList.add('locked');
            row.querySelectorAll('input[type="radio"]').forEach(inp => inp.disabled = true);
            const icon = row.querySelector('.student-info i');
            if(icon) icon.style.color = 'var(--success)';
        }

        // Background Submit to Google Form
        try {
            await fetch(submitUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded' 
                },
                body: payloadParams.toString()
            });
            
            if (!isBulk) showToast(`Attendance submitted successfully`, 'success');
            return true;
        } catch (error) {
            console.error("Google Forms Sync Error:", error);
            if (!isBulk) showToast(`Failed to submit attendance to Google Form`, 'error');
            return false;
        }
    }

    // --- Bulk Action Logic ---
    async function processBulkAction(batch, status) {
        if (!googleFormConfig || !googleFormConfig.url) return showToast('Please configure Google Form first', 'error');

        const unmarkedStudents = students.filter(s => s.batch === batch && !getTodayRecord(s.id));
        
        if(unmarkedStudents.length === 0) {
            return showToast(`All students in ${batch} are already marked.`, 'info');
        }

        showToast(`Submitting ${unmarkedStudents.length} records...`, 'info');

        for (const student of unmarkedStudents) {
            const radio = document.querySelector(`input[name="status-${student.id}"][value="${status}"]`);
            if(radio) radio.checked = true;
            await markAttendance(student.id, student.name, student.batch, status, true); 
        }

        showToast(`${batch} attendance submitted successfully`, 'success');
    }

    // --- Final Submit (Mark Remaining Absent) ---
    finalSubmitBtn.addEventListener('click', async () => {
        if (!googleFormConfig || !googleFormConfig.url) return showToast('Please configure Google Form first', 'error');

        const unmarkedStudents = students.filter(s => !getTodayRecord(s.id));

        if(unmarkedStudents.length === 0) {
            return showToast('Attendance is already complete for today!', 'success');
        }

        const confirmMsg = `Are you sure? This will mark ${unmarkedStudents.length} remaining student(s) as Absent.`;
        if(!confirm(confirmMsg)) return;

        showToast(`Submitting Final Attendance...`, 'info');
        finalSubmitBtn.disabled = true;
        finalSubmitBtn.innerHTML = '<i class="ph ph-spinner-gap"></i> Processing...';

        for (const student of unmarkedStudents) {
            const radio = document.querySelector(`input[name="status-${student.id}"][value="A"]`);
            if(radio) radio.checked = true;
            await markAttendance(student.id, student.name, student.batch, 'A', true);
        }

        showToast('Final Attendance submitted successfully', 'success');
        finalSubmitBtn.disabled = false;
        finalSubmitBtn.innerHTML = '<i class="ph ph-check-circle"></i> Done for Today';
    });

    // --- Toast Notification System ---
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let iconClass = 'ph-check-circle';
        if(type === 'error') iconClass = 'ph-x-circle';
        if(type === 'warning' || type === 'info') iconClass = 'ph-info';

        toast.innerHTML = `<i class="ph-fill ${iconClass}"></i> <span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3500);
    }

    // Start App
    init();
});