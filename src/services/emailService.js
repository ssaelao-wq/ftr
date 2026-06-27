'use strict';

/**
 * src/services/emailService.js
 * Phase 4 — Email Engine
 *
 * Sends the Full Tax Invoice PDF via Gmail using OAuth2 credentials
 * stored in environment variables (Option A from setup_sending_via_gmail.md).
 *
 * Required env vars:
 *   EMAIL_USER            — the Gmail / Workspace address that sends the email
 *   OAUTH_CLIENT_ID       — GCP OAuth2 client ID
 *   OAUTH_CLIENT_SECRET   — GCP OAuth2 client secret
 *   OAUTH_REFRESH_TOKEN   — Long-lived refresh token from OAuth Playground
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const { google }  = require('googleapis');
const path        = require('path');
const fs          = require('fs');

// ---------------------------------------------------------------------------
// Build a fresh OAuth2 access token for each send to avoid token expiry
// ---------------------------------------------------------------------------
async function createTransporter() {
    if (process.env.OAUTH_REFRESH_TOKEN) {
        // Option A: Google Cloud OAuth2
        const oauth2Client = new google.auth.OAuth2(
            process.env.OAUTH_CLIENT_ID,
            process.env.OAUTH_CLIENT_SECRET,
            'https://developers.google.com/oauthplayground' // Redirect URI used during token generation
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.OAUTH_REFRESH_TOKEN
        });

        // Obtain a short-lived access token
        const { token: accessToken } = await oauth2Client.getAccessToken();

        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type:         'OAuth2',
                user:         process.env.EMAIL_USER,
                clientId:     process.env.OAUTH_CLIENT_ID,
                clientSecret: process.env.OAUTH_CLIENT_SECRET,
                refreshToken: process.env.OAUTH_REFRESH_TOKEN,
                accessToken:  accessToken
            }
        });
    } else if (process.env.EMAIL_PASS) {
        // Option C: Gmail App Password
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    } else {
        throw new Error('No valid email credentials found. Please set OAUTH_REFRESH_TOKEN (Option A) or EMAIL_PASS (Option C) in your .env file.');
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends the Full Tax Invoice PDF to the specified email address.
 *
 * @param {string} emailSending  — Recipient email address
 * @param {string} taxRecId      — Tax Record ID (e.g. RF2605-00589)
 * @param {string} taxId         — Customer Tax ID (13-digit)
 * @param {string} pdfRelPath    — Relative path to the PDF file (e.g. /storage/pdfs/Unicon_RF2605-00589.pdf)
 * @returns {Promise<object>}    — nodemailer info object on success
 */
async function sendInvoiceEmail(emailSending, arg2, arg3, arg4) {
    let taxId;
    let invoicesData = [];

    if (Array.isArray(arg3)) {
        // New signature: sendInvoiceEmail(emailSending, taxId, invoicesData)
        taxId = arg2;
        invoicesData = arg3;
    } else {
        // Old signature: sendInvoiceEmail(emailSending, taxRecId, taxId, pdfRelPath)
        const taxRecId = arg2;
        taxId = arg3;
        const pdfRelPath = arg4;
        invoicesData = [{ taxRecId, pdfRelPath }];
    }

    // Resolve absolute path from project root (this file lives at src/services/)
    const projectRoot  = path.join(__dirname, '../../');
    const transporter = await createTransporter();

    const attachments = invoicesData.map(item => {
        const itemTaxRecId = item.taxRecId || item.tax_rec_id;
        const absolutePath = path.join(projectRoot, item.pdfRelPath);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`PDF file not found at path: ${absolutePath}`);
        }
        return {
            filename:    `Unicon_${itemTaxRecId}.pdf`,
            path:        absolutePath,
            contentType: 'application/pdf'
        };
    });

    // Add signature and QR inline images if they exist
    const sigPath = path.join(projectRoot, 'Unicon_SignatureImage.jpg');
    if (fs.existsSync(sigPath)) {
        attachments.push({
            filename: 'Unicon_SignatureImage.jpg',
            path: sigPath,
            cid: 'unicon_signature_image'
        });
    }

    const qrPath = path.join(projectRoot, 'Unicon_QR.jpg');
    if (fs.existsSync(qrPath)) {
        attachments.push({
            filename: 'Unicon_QR.jpg',
            path: qrPath,
            cid: 'unicon_qr'
        });
    }

    const taxRecIdsStr = invoicesData.map(item => item.taxRecId || item.tax_rec_id).join(', ');

    const mailOptions = {
        from:    `"Unicon Container Services" <${process.env.EMAIL_USER}>`,
        to:      emailSending,
        subject: `ใบกำกับภาษีแบบเต็ม สำหรับเลขประจำตัวผู้เสียภาษี: ${taxId}`,
        text:    `เรียน ลูกค้าและผู้มาใช้บริการ\n\nใบกำกับภาษีแบบเต็มสำหรับหมายเลขเอกสาร ${taxRecIdsStr} ของเลขประจำตัวผู้เสียภาษี ${taxId} ได้แนบมาพร้อมกับอีเมลฉบับนี้เรียบร้อยแล้ว\nหากท่านมีข้อสงสัยหรือต้องการสอบถามข้อมูลเพิ่มเติม กรุณาติดต่อ แผนกบัญชี โทรศัพท์ 02-738-8914 ในวันและเวลาทำการ เจ้าหน้าที่ของเรายินดีให้บริการ\n\nขอขอบพระคุณที่ไว้วางใจใช้บริการกับเรา\nหมายเหตุ: อีเมลฉบับนี้จัดส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลนี้ หากต้องการติดต่อหรือสอบถามข้อมูลเพิ่มเติม กรุณาติดต่อบริษัทผ่านช่องทางที่ระบุข้างต้น\n\nUnicon Container Services Co.,Ltd.\nเปิดทำการ จันทร์-เสาร์ เวลา 08.00-18.00 น.\nCheck booking http://150.95.90.37/bis`,
        html: `
            <div style="font-family: sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
                <p>เรียน ลูกค้าและผู้มาใช้บริการ</p>
                <br>
                <p>ใบกำกับภาษีแบบเต็มสำหรับหมายเลขเอกสาร <strong>${taxRecIdsStr}</strong> ของเลขประจำตัวผู้เสียภาษี <strong>${taxId}</strong> ได้แนบมาพร้อมกับอีเมลฉบับนี้เรียบร้อยแล้ว</p>
                <p>หากท่านมีข้อสงสัยหรือต้องการสอบถามข้อมูลเพิ่มเติม กรุณาติดต่อ แผนกบัญชี โทรศัพท์ <strong>02-738-8914</strong> ในวันและเวลาทำการ เจ้าหน้าที่ของเรายินดีให้บริการ</p>
                <br>
                <p>ขอขอบพระคุณที่ไว้วางใจใช้บริการกับเรา</p>
                <p style="color: #666; font-size: 12px; font-weight: bold;"><strong>หมายเหตุ:</strong> อีเมลฉบับนี้จัดส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลนี้ หากต้องการติดต่อหรือสอบถามข้อมูลเพิ่มเติม กรุณาติดต่อบริษัทผ่านช่องทางที่ระบุข้างต้น</p>
                <br>
                <p><img src="cid:unicon_signature_image" alt="Unicon Signature" style="width: 250px; max-width: 100%; height: auto; display: block; margin: 10px 0;" /></p>
                <br>
                <p>Unicon Container Services Co.,Ltd.<br>
                เปิดทำการ จันทร์-เสาร์ เวลา 08.00-18.00 น.<br>
                Check booking <a href="http://150.95.90.37/bis" target="_blank">http://150.95.90.37/bis</a></p>
                <p><img src="cid:unicon_qr" alt="Unicon QR" style="width: 250px; max-width: 100%; height: auto; display: block; margin: 10px 0;" /></p>
            </div>
        `,
        attachments: attachments
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[emailService] Email sent to ${emailSending} for ${taxRecIdsStr} — MessageId: ${info.messageId}`);
    return info;
}

module.exports = { sendInvoiceEmail };
