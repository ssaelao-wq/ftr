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
 * @param {string} pdfRelPath    — Relative path to the PDF file (e.g. /storage/pdfs/FTR_RF2605-00589.pdf)
 * @returns {Promise<object>}    — nodemailer info object on success
 */
async function sendInvoiceEmail(emailSending, taxRecId, taxId, pdfRelPath) {
    // Resolve absolute path from project root (this file lives at src/services/)
    const projectRoot  = path.join(__dirname, '../../');
    const absolutePath = path.join(projectRoot, pdfRelPath);

    if (!fs.existsSync(absolutePath)) {
        throw new Error(`PDF file not found at path: ${absolutePath}`);
    }

    const transporter = await createTransporter();

    const mailOptions = {
        from:    `"FTR Invoice System" <${process.env.EMAIL_USER}>`,
        to:      emailSending,
        subject: `ใบกำกับภาษีแบบเต็ม ${taxRecId}`,
        text:    `ใบกำกับภาษีแบบเต็มของ ${taxRecId} สำหรับภาษีหมายเลข ${taxId}\n\nกรุณาดูไฟล์แนบ`,
        html: `
            <div style="font-family: sans-serif; font-size: 14px; color: #333;">
                <p>เรียนลูกค้า,</p>
                <p>ใบกำกับภาษีแบบเต็มของหมายเลขเอกสาร <strong>${taxRecId}</strong> สำหรับเลขประจำตัวผู้เสียภาษี <strong>${taxId}</strong> ได้ถูกแนบมาพร้อมกับอีเมล์ฉบับนี้แล้ว</p>
                <p>หากมีคำถามใดๆ กรุณาติดต่อเจ้าหน้าที่</p>
                <br>
                <p style="color: #999; font-size: 12px;">อีเมล์นี้ถูกส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ</p>
            </div>
        `,
        attachments: [
            {
                filename:    `FTR_${taxRecId}.pdf`,
                path:        absolutePath,
                contentType: 'application/pdf'
            }
        ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[emailService] Email sent to ${emailSending} for ${taxRecId} — MessageId: ${info.messageId}`);
    return info;
}

module.exports = { sendInvoiceEmail };
