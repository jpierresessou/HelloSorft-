const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SUPABASE_URL = 'https://fxlvovlepjjffjgwifej.supabase.co';
const SUPABASE_SERVICE_KEY = 'sb_secret_vMCfm9LRtWx20HlBl-CE9g__CF9bLSI';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const clients = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

wss.on('connection', (ws) => {
    console.log('🟢 Client WebSocket connecté');
    let userPhone = null;
    let userName = null;

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            console.log('📩 Message reçu:', msg.type);

            if (msg.type === 'register') {
                userPhone = msg.phone; userName = msg.name;
                clients.set(ws, { phone: userPhone, name: userName });
                console.log('📝 Inscription:', userPhone, userName);
                await supabase.from('users').upsert({ phone: userPhone, name: userName, password: msg.password || '', photo: msg.photo || null });
                ws.send(JSON.stringify({ type: 'register-success', phone: userPhone, name: userName }));
                console.log('✅ register-success envoyé');
            }
            else if (msg.type === 'login') {
                const { data: user } = await supabase.from('users').select('*').eq('phone', msg.phone).single();
                if (user && user.password === msg.password) {
                    userPhone = msg.phone; userName = user.name;
                    clients.set(ws, { phone: userPhone, name: userName });
                    ws.send(JSON.stringify({ type: 'user-data', phone: user.phone, name: user.name, photo: user.photo || '' }));
                } else { ws.send(JSON.stringify({ type: 'error', message: 'Identifiants incorrects' })); }
            }
            else if (msg.type === 'check-contact') {
                const { data: user } = await supabase.from('users').select('phone, name, photo').eq('phone', msg.phone).single();
                if (user) {
                    await supabase.from('contacts').upsert({ user_phone: userPhone, contact_phone: msg.phone, contact_name: user.name, contact_photo: user.photo || '' });
                    ws.send(JSON.stringify({ type: 'contact-check', isHellosorft: true, phone: msg.phone, userName: user.name }));
                } else { ws.send(JSON.stringify({ type: 'contact-check', isHellosorft: false })); }
            }
            else if (msg.type === 'get-contacts') {
                const { data: contacts } = await supabase.from('contacts').select('*').eq('user_phone', userPhone);
                ws.send(JSON.stringify({ type: 'contacts-list', contacts: contacts || [] }));
            }
            else if (msg.type === 'update-profile') {
                const updates = { name: msg.name }; if (msg.password) updates.password = msg.password; if (msg.photo) updates.photo = msg.photo;
                await supabase.from('users').update(updates).eq('phone', userPhone);
                ws.send(JSON.stringify({ type: 'profile-updated' }));
            }
            else if (msg.type === 'delete-account') {
                await supabase.from('contacts').delete().eq('user_phone', userPhone);
                await supabase.from('messages').delete().or(`sender_phone.eq.${userPhone},receiver_phone.eq.${userPhone}`);
                await supabase.from('users').delete().eq('phone', userPhone);
                ws.send(JSON.stringify({ type: 'account-deleted' }));
            }
            else if (msg.type === 'text-message' || msg.type === 'image-message' || msg.type === 'voice-message') {
                clients.forEach((v, c) => { if (v.phone === msg.to && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(msg)); });
            }
            else if (msg.type === 'ptt-start' || msg.type === 'ptt-end' || msg.type === 'read' || msg.type === 'typing') {
                clients.forEach((v, c) => { if (v.phone === msg.to && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(msg)); });
            }
        } catch (e) { console.error('❌ Erreur:', e); }
    });

    ws.on('close', () => { console.log('🔴 Client déconnecté'); clients.delete(ws); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('📻 HelloSorft port ' + PORT));