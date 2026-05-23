document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const batchesContainer = document.getElementById('batches-container');
    const currentDateDisplay = document.getElementById('current-date-display');
    const toastContainer = document.getElementById('toast-container');
    const finalSubmitBtn = document.getElementById('final-submit-btn');

    // Modals & Forms
    const addStudentModal = document.getElementById('add-student-modal');
    const settingsModal = document.getElementById('settings-modal');
    const confirmCompleteModal = document.getElementById('confirm-complete-modal');
    const confirmCompleteBtn = document.getElementById('confirm-complete-btn');
    const addStudentForm = document.getElementById('add-student-form');
    const configForm = document.getElementById('config-form');
    
    // Top action buttons
    const importCsvBtn = document.getElementById('import-csv-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const csvFileInput = document.getElementById('csv-file-input');
    const remindersToggle = document.getElementById('config-reminders');

    // --- State Management ---
    let students = JSON.parse(localStorage.getItem('students')) || [];
    let attendanceRecords = JSON.parse(localStorage.getItem('attendance')) || [];
    let googleFormConfig = JSON.parse(localStorage.getItem('googleFormConfig')) || null;
    let appSettings = JSON.parse(localStorage.getItem('appSettings')) || { remindersEnabled: true };
    
    // Internal Unique ID Sequence tracking
    let lastStudentIdSeq = parseInt(localStorage.getItem('lastStudentIdSeq') || '0', 10);
    let studentIdToDelete = null; 
    
    const todayStr = new Date().toLocaleDateString('en-CA'); 

    // Notification Log
    let notificationLog = JSON.parse(localStorage.getItem('notificationLog')) || { date: todayStr, notifiedBatches: [] };
    if (notificationLog.date !== todayStr) {
        notificationLog = { date: todayStr, notifiedBatches: [] };
        localStorage.setItem('notificationLog', JSON.stringify(notificationLog));
    }

    // --- Initialization ---
    function init() {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        currentDateDisplay.textContent = new Date().toLocaleDateString('en-US', options);

        if (googleFormConfig) prefillConfigForm();
        remindersToggle.checked = appSettings.remindersEnabled;

        // Sync sequence with any existing data to ensure we never overwrite/duplicate IDs
        students.forEach(s => syncIdSequence(s.id));

        renderBatches();

        // Start Background Reminder Service
        requestNotificationPermission();
        setInterval(checkAttendanceReminders, 60000); 
        setTimeout(checkAttendanceReminders, 5000); 
    }

    // --- STRICT Student ID Generator System ---
    function generateNextId() {
        lastStudentIdSeq++;
        localStorage.setItem('lastStudentIdSeq', lastStudentIdSeq);
        // Enforce STRICT ST001 format
        return 'ST' + lastStudentIdSeq.toString().padStart(3, '0');
    }

    // Safely bumps the sequence if a higher ID exists or is imported via CSV
    function syncIdSequence(idStr) {
        if (idStr && /^ST\d{3,}$/.test(idStr)) { // strictly matches ST001, ST025, ST1000
            const num = parseInt(idStr.replace('ST', ''), 10);
            if (!isNaN(num) && num > lastStudentIdSeq) {
                lastStudentIdSeq = num;
                localStorage.setItem('lastStudentIdSeq', lastStudentIdSeq);
            }
        }
    }


    // --- CSV Import & Export Logic ---

    // 1. Export CSV
    exportCsvBtn.addEventListener('click', () => {
        if (students.length === 0) return showToast('No students to export!', 'warning');
        showToast('Exporting data...', 'info');

        // Prepare CSV Content (Format: ID,Student Name,Batch)
        let csvContent = "ID,Student Name,Batch\n";
        
        const sortedExports = [...students].sort((a, b) => {
            if (a.batch === b.batch) return a.name.localeCompare(b.name);
            return a.batch.localeCompare(b.batch);
        });

        sortedExports.forEach(student => {
            const safeName = student.name.includes(',') ? `"${student.name}"` : student.name;
            const safeBatch = student.batch.includes(',') ? `"${student.batch}"` : student.batch;
            csvContent += `${student.id},${safeName},${safeBatch}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `students_${todayStr}.csv`);
        document.body.appendChild(link);
        
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });

    // 2. Import CSV
    importCsvBtn.addEventListener('click', () => csvFileInput.click());

    csvFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type !== "text/csv" && !file.name.endsWith('.csv')) {
            showToast('Please upload a valid .csv file', 'error');
            csvFileInput.value = ''; 
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            processCsvData(event.target.result);
            csvFileInput.value = ''; 
        };
        reader.onerror = () => {
            showToast('Error reading the file', 'error');
            csvFileInput.value = '';
        };

        reader.readAsText(file);
        showToast('Processing file...', 'info');
    });

    function processCsvData(csvText) {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) return showToast('CSV is empty or missing headers', 'error');

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const idIdx = headers.findIndex(h => h === 'id' || h === 'student id');
        const nameIdx = headers.findIndex(h => h.includes('name'));
        const batchIdx = headers.findIndex(h => h.includes('batch'));

        if (nameIdx === -1 || batchIdx === -1) {
            return showToast('Invalid format. Headers must include "Student Name" and "Batch"', 'error');
        }

        let imported = 0;
        let duplicateSkipped = 0;
        let errorsSkipped = 0;

        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            
            const name = (row[nameIdx] || '').replace(/^["']|["']$/g, '').trim();
            const batch = (row[batchIdx] || '').replace(/^["']|["']$/g, '').trim();

            if (!name || !batch) {
                errorsSkipped++;
                continue;
            }

            let csvId = idIdx !== -1 ? (row[idIdx] || '').replace(/^["']|["']$/g, '').trim() : '';
            let finalId = '';

            if (csvId) {
                // Check if the provided ID STRICTLY matches ST001 format
                if (/^ST\d{3,}$/.test(csvId)) {
                    
                    // Check for duplicates
                    const isDuplicateId = students.some(s => s.id === csvId);
                    if (isDuplicateId) {
                        duplicateSkipped++; // Skip entirely, do not overwrite or auto-generate
                        continue;
                    }

                    // ID is valid and unique
                    finalId = csvId;
                    syncIdSequence(finalId);
                } else {
                    // ID format is invalid (e.g., ST1, 001, ABC) -> auto generate proper ID
                    finalId = generateNextId();
                }
            } else {
                // No ID provided -> auto generate proper ID
                finalId = generateNextId();
            }

            students.push({ id: finalId, name, batch });
            imported++;
        }

        if (imported > 0 || duplicateSkipped > 0 || errorsSkipped > 0) {
            localStorage.setItem('students', JSON.stringify(students));
            renderBatches();
            
            // Build Summary Message
            let summaryMsg = `${imported} students imported`;
            if (duplicateSkipped > 0) summaryMsg += `<br>${duplicateSkipped} duplicate IDs skipped`;
            if (errorsSkipped > 0) summaryMsg += `<br>${errorsSkipped} invalid rows skipped`;
            
            showToast(summaryMsg, imported > 0 ? 'success' : 'warning');
        }
    }


    // --- Background Reminder System ---
    function requestNotificationPermission() {
        if (appSettings.remindersEnabled && "Notification" in window) {
            if (Notification.permission === "default") Notification.requestPermission();
        }
    }

    function playReminderSound() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime); 
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        } catch (e) { console.error("Sound failed", e); }
    }

    function parseBatchTimeToDate(batchStr) {
        const [time, modifier] = batchStr.split(' ');
        let [hours, minutes] = time.split(':');
        hours = parseInt(hours, 10);
        minutes = parseInt(minutes, 10);

        if (hours === 12) hours = modifier === 'PM' ? 12 : 0;
        else if (modifier === 'PM') hours += 12;

        const targetDate = new Date();
        targetDate.setHours(hours, minutes, 0, 0);
        return targetDate;
    }

    function checkAttendanceReminders() {
        if (!appSettings.remindersEnabled || !("Notification" in window) || Notification.permission !== "granted") return;

        const uniqueBatches = [...new Set(students.map(s => s.batch))];
        const now = new Date();

        uniqueBatches.forEach(batch => {
            if (notificationLog.notifiedBatches.includes(batch)) return;
            
            const batchTime = parseBatchTimeToDate(batch);
            const notifyTime = new Date(batchTime.getTime() + (65 * 60000)); // +1 hr 5 min

            if (now >= notifyTime) {
                const isAttendanceMarked = attendanceRecords.some(r => r.batch === batch && r.date === todayStr);

                if (!isAttendanceMarked) {
                    new Notification("Attendance Reminder", { body: `Mark your attendance for ${batch} batch.` });
                    playReminderSound();
                    notificationLog.notifiedBatches.push(batch);
                    localStorage.setItem('notificationLog', JSON.stringify(notificationLog));
                }
            }
        });
    }

    // --- Modal Logic ---
    const toggleModal = (modal, show) => {
        if (show) modal.classList.add('active');
        else modal.classList.remove('active');
    };

    document.getElementById('open-add-student-btn').addEventListener('click', () => toggleModal(addStudentModal, true));
    document.getElementById('settings-btn').addEventListener('click', () => toggleModal(settingsModal, true));

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => toggleModal(e.target.closest('.modal-overlay'), false));
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

        appSettings.remindersEnabled = remindersToggle.checked;

        localStorage.setItem('googleFormConfig', JSON.stringify(googleFormConfig));
        localStorage.setItem('appSettings', JSON.stringify(appSettings));

        if (appSettings.remindersEnabled) requestNotificationPermission();

        showToast('Settings saved successfully!', 'success');
        toggleModal(settingsModal, false);
    });

    function prefillConfigForm() {
        if(!googleFormConfig) return;
        document.getElementById('config-url').value = googleFormConfig.url || '';
        document.getElementById('config-name-key').value = googleFormConfig.nameKey || '';
        document.getElementById('config-status-key').value = googleFormConfig.statusKey || '';
        document.getElementById('config-batch-key').value = googleFormConfig.batchKey || '';
    }

    // --- Add Single Student Logic ---
    addStudentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('new-student-name').value.trim();
        const batchInput = document.getElementById('new-batch').value.trim();

        if (!nameInput || !batchInput) return showToast('Please fill all fields', 'error');

        // Automatically Generate Internal ID
        const newId = generateNextId();

        students.push({ id: newId, name: nameInput, batch: batchInput });
        localStorage.setItem('students', JSON.stringify(students));

        showToast('Student added successfully!', 'success');
        addStudentForm.reset();
        toggleModal(addStudentModal, false);
        renderBatches();
    });

    function getTodayRecord(studentId) {
        return attendanceRecords.find(r => r.studentId === studentId && r.date === todayStr);
    }

    // --- Complete Course (Delete Student) Logic ---
    confirmCompleteBtn.addEventListener('click', () => {
        if (!studentIdToDelete) return;

        // All internal tracking strictly uses student.id
        students = students.filter(s => s.id !== studentIdToDelete);
        attendanceRecords = attendanceRecords.filter(r => r.studentId !== studentIdToDelete);

        localStorage.setItem('students', JSON.stringify(students));
        localStorage.setItem('attendance', JSON.stringify(attendanceRecords));

        showToast('Student completed and data removed.', 'success');
        
        studentIdToDelete = null;
        toggleModal(confirmCompleteModal, false);
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
                    <p>Add students or Import CSV to start taking attendance.</p>
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

                // ID remains hidden from UI, tied only to data-id
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

        document.querySelectorAll('.status-radio').forEach(radio => {
            radio.addEventListener('change', async (e) => {
                if(e.target.checked) {
                    const { id, batch, name } = e.target.dataset;
                    await markAttendance(id, name, batch, e.target.value, false);
                }
            });
        });

        document.querySelectorAll('.bulk-action').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const { batch, status } = e.target.dataset;
                await processBulkAction(batch, status);
            });
        });

        document.querySelectorAll('.trigger-complete').forEach(btn => {
            btn.addEventListener('click', (e) => {
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

        // Send Student Name to Google form, NOT ID
        const payloadObj = {};
        payloadObj[googleFormConfig.nameKey] = studentName; 
        payloadObj[googleFormConfig.statusKey] = status;
        payloadObj[googleFormConfig.batchKey] = batch;

        const payloadParams = new URLSearchParams(payloadObj);

        // Save Locally immediately referencing ID
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

        const row = document.getElementById(`row-${studentId}`);
        if(row) {
            row.classList.add('locked');
            row.querySelectorAll('input[type="radio"]').forEach(inp => inp.disabled = true);
            const icon = row.querySelector('.student-info i');
            if(icon) icon.style.color = 'var(--success)';
        }

        try {
            await fetch(submitUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

    async function processBulkAction(batch, status) {
        if (!googleFormConfig || !googleFormConfig.url) return showToast('Please configure Google Form first', 'error');

        const unmarkedStudents = students.filter(s => s.batch === batch && !getTodayRecord(s.id));
        if(unmarkedStudents.length === 0) return showToast(`All students in ${batch} are already marked.`, 'info');

        showToast(`Submitting ${unmarkedStudents.length} records...`, 'info');

        for (const student of unmarkedStudents) {
            const radio = document.querySelector(`input[name="status-${student.id}"][value="${status}"]`);
            if(radio) radio.checked = true;
            await markAttendance(student.id, student.name, student.batch, status, true); 
        }

        showToast(`${batch} attendance submitted successfully`, 'success');
    }

    finalSubmitBtn.addEventListener('click', async () => {
        if (!googleFormConfig || !googleFormConfig.url) return showToast('Please configure Google Form first', 'error');

        const unmarkedStudents = students.filter(s => !getTodayRecord(s.id));
        if(unmarkedStudents.length === 0) return showToast('Attendance is already complete for today!', 'success');

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
        }, 3500); // slightly longer timeout to allow multi-line reading
    }

    init();
});