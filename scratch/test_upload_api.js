const fs = require('fs');
const path = require('path');

async function testUpload() {
    try {
        const filePath = path.join(__dirname, '../customer_data-11Jul-02.csv');
        const fileBuffer = fs.readFileSync(filePath);
        
        // Create FormData
        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: 'text/csv' });
        formData.append('file', blob, 'customer_data-11Jul-02.csv');
        
        console.log('Sending file upload request to http://localhost:3000/api/admin/upload/customer-profile...');
        const response = await fetch('http://localhost:3000/api/admin/upload/customer-profile', {
            method: 'POST',
            body: formData
        });
        
        const text = await response.text();
        console.log('Status code:', response.status);
        console.log('Response body:', text);
    } catch (e) {
        console.error('Error during test upload:', e);
    }
}

testUpload();
