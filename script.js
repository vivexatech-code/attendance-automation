document.addEventListener('DOMContentLoaded', () => {
    
    // --- DOM Elements ---
    const addStudentForm = document.getElementById('add-student-form');
    const attendanceForm = document.getElementById('attendance-form');
    const configForm = document.getElementById('config-form');
    
    const studentSelect = document.getElementById('student-select');
    const studentBatchInput = document.getElementById('student-batch');
    const toastContainer = document.getElementById('toast-container');
    
    const settingsBtn = document.getElementById('settings-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const settingsModal = document.getElementById('settings-modal');

    // --- State Management ---
    let students = JSON.parse(localStorage.getItem('students')) || [];
    let attendanceRecords = JSON.parse(localStorage.getItem('attendance')) || [];
    let googleFormConfig = JSON.parse(localStorage.getItem('googleFormConfig')) || null;

    // --- Initialization ---
    function init() {
        populateStudentDropdown();
        if (googleFormConfig) {
            prefillConfigForm();
        }
    }

    // --- Modal Logic ---
    const toggleModal = (show) => {
        if (show) {
            settingsModal.classList.add('active');
        } else {
            settingsModal.classList.remove('active');
        }
    };

    settingsBtn.addEventListener('click', () => toggleModal(true));
    closeModalBtn.addEventListener('click', () => toggleModal(false));
    
    // Close modal on clicking outside the card
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) toggleModal(false);
    });

    // --- Google Form Settings Configuration ---
    configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        let url = document.getElementById('config-url').value.trim();
        
        // Basic cleanup of URL during save (strip query params like ?usp=sf_link)
        url = url.split('?')[0];
        
        googleFormConfig = {
            url: url,
            nameKey: document.getElementById('config-name-key').value.trim(),
            statusKey: document.getElementById('config-status-key').value.trim(),
            batchKey: document.getElementById('config-batch-key').value.trim()
        };

        localStorage.setItem('googleFormConfig', JSON.stringify(googleFormConfig));
        
        showToast('Configuration saved successfully!', 'success');
        toggleModal(false);
    });

    function prefillConfigForm() {
        document.getElementById('config-url').value = googleFormConfig.url;
        document.getElementById('config-name-key').value = googleFormConfig.nameKey;
        document.getElementById('config-status-key').value = googleFormConfig.statusKey;
        document.getElementById('config-batch-key').value = googleFormConfig.batchKey;
    }

    // --- Add Student Logic ---
    addStudentForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const nameInput = document.getElementById('new-student-name').value.trim();
        const batchInput = document.getElementById('new-batch').value.trim();

        if (!nameInput || !batchInput) return showToast('Please fill all fields', 'error');

        // Check duplicates
        const isDuplicate = students.some(
            student => student.name.toLowerCase() === nameInput.toLowerCase() && 
                       student.batch.toLowerCase() === batchInput.toLowerCase()
        );

        if (isDuplicate) return showToast('Student already exists in this batch', 'error');

        const newStudent = { id: Date.now().toString(), name: nameInput, batch: batchInput };

        students.push(newStudent);
        localStorage.setItem('students', JSON.stringify(students));

        showToast('Student added successfully!', 'success');
        addStudentForm.reset();
        populateStudentDropdown();
    });

    // --- Attendance Auto-fill Logic ---
    studentSelect.addEventListener('change', (e) => {
        const student = students.find(s => s.id === e.target.value);
        studentBatchInput.value = student ? student.batch : '';
    });

    // --- Attendance Submission (Local Storage + Google Form) ---
    attendanceForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Check Configuration
        if (!googleFormConfig) {
            showToast('Please configure Google Form first via Settings.', 'warning');
            toggleModal(true); 
            return;
        }

        const selectedId = studentSelect.value;
        const batch = studentBatchInput.value; // The exact batch saved by the user
        const statusElement = document.querySelector('input[name="attendance-status"]:checked');

        // 2. Strict Validations
        if (!selectedId) return showToast('Please select a student', 'error');
        if (!batch) return showToast('Batch field is empty', 'error');
        if (!statusElement) return showToast('Please select an attendance status', 'error');

        const student = students.find(s => s.id === selectedId);
        const statusValue = statusElement.value;
        const currentTime = new Date();

        // 3. Save locally
        const record = {
            id: Date.now().toString(),
            studentId: selectedId,
            studentName: student.name,
            batch: batch,
            status: statusValue,
            timestamp: currentTime.toISOString() // ISO format for internal database only
        };

        attendanceRecords.push(record);
        localStorage.setItem('attendance', JSON.stringify(attendanceRecords));

        // 4. Prepare Google Form Payload (URL-encoded format)
        const payload = new URLSearchParams();
        payload.append(googleFormConfig.nameKey, student.name);
        payload.append(googleFormConfig.statusKey, statusValue);
        
        // This will now send exactly what is in the "Batch" input box, not the current time
        payload.append(googleFormConfig.batchKey, batch); 

        // 5. Format the Google Form Submission URL
        let submitUrl = googleFormConfig.url.split('?')[0]; // Ensure no query parameters
        if (submitUrl.endsWith('/viewform')) {
            submitUrl = submitUrl.replace('/viewform', '/formResponse');
        } else if (!submitUrl.endsWith('/formResponse')) {
            // Failsafe if user pasted a root URL without /viewform
            submitUrl = submitUrl.replace(/\/+$/, '') + '/formResponse'; 
        }

        // 6. Debugging Output
        console.log("==== Google Form Submission Debug ====");
        console.log("Selected Student:", student.name);
        console.log("Selected Status:", statusValue);
        console.log("Batch Data Sent:", batch);
        console.log("Final Google Form URL:", submitUrl);
        console.log("Generated Payload:", payload.toString());
        console.log("======================================");

        // 7. Submit to Google Form
        try {
            await fetch(submitUrl, {
                method: 'POST',
                mode: 'no-cors', // Opaque request for cross-origin submission
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: payload.toString()
            });

            // Since mode is no-cors, we assume success if fetch doesn't throw a network error
            showToast(`Attendance synced for ${student.name}`, 'success');
            
            // Form Reset
            attendanceForm.reset();
            studentSelect.value = "";
            studentBatchInput.value = "";
            
        } catch (error) {
            console.error("Error submitting to Google Forms:", error);
            showToast('Saved locally, but network error occurred during sync.', 'error');
        }
    });

    // --- Helpers ---
    function populateStudentDropdown() {
        studentSelect.innerHTML = '<option value="" disabled selected>-- Choose a student --</option>';
        const sortedStudents = [...students].sort((a, b) => a.name.localeCompare(b.name));

        sortedStudents.forEach(student => {
            const option = document.createElement('option');
            option.value = student.id;
            option.textContent = `${student.name} (${student.batch})`;
            studentSelect.appendChild(option);
        });
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let iconClass = 'ph-check-circle';
        if(type === 'error') iconClass = 'ph-x-circle';
        if(type === 'warning') iconClass = 'ph-warning-circle';

        toast.innerHTML = `<i class="ph-fill ${iconClass}"></i> <span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    // Run Init
    init();
});