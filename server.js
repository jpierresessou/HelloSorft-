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
    let userPhone = null;
    let userName = null;

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'register') {
                userPhone = msg.phone;
                userName = msg.name;
                clients.set(ws, { phone: userPhone, name: userName });
                await supabase.from('users').upsert({ phone: userPhone, name: userName, password: msg.password || '' });
                ws.send(JSON.stringify({ type: 'register-success', phone: userPhone }));
                broadcastUsers();
            } else if (msg.type === 'join') {
                userPhone = msg.phone;
                userName = msg.name || msg.phone;
                clients.set(ws, { phone: userPhone, name: userName });
                ws.send(JSON.stringify({ type: 'join-success' }));
                broadcastUsers();
            } else if (msg.type === 'check-contact') {
                const { data: user } = await supabase.from('users').select('phone, name').eq('phone', msg.phone).single();
                if (user) {
                    await supabase.from('contacts').upsert({ user_phone: userPhone, contact_phone: msg.phone, contact_name: user.name });
                    ws.send(JSON.stringify({ type: 'contact-check', isHellosorft: true, phone: msg.phone, userName: user.name }));
                } else {
                    ws.send(JSON.stringify({ type: 'contact-check', isHellosorft: false }));
                }
            } else if (msg.type === 'get-contacts') {
                const { data: contacts } = await supabase.from('contacts').select('*').eq('user_phone', userPhone);
                const withStatus = (contacts || []).map(c => ({
                    ...c,
                    online: [...clients.values()].some(cl => cl.phone === c.contact_phone)
                }));
                ws.send(JSON.stringify({ type: 'contacts-list', contacts: withStatus }));
            } else if (msg.type === 'text-message' || msg.type === 'image-message' || msg.type === 'voice-message') {
                await supabase.from('messages').insert({
                    sender_phone: userPhone,
                    receiver_phone: msg.to,
                    type: msg.type === 'text-message' ? 'text' : msg.type === 'image-message' ? 'image' : 'voice',
                    content: msg.text || null,
                    image_url: msg.imageData || null,
                    audio_url: msg.audioData || null,
                    expires_at: new Date(Date.now() + 86400000).toISOString()
                });
                clients.forEach((v, c) => {
                    if (v.phone === msg.to && c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({ ...msg, userName }));
                    }
                });
            } else if (msg.type === 'ptt-start' || msg.type === 'ptt-end') {
                clients.forEach((v, c) => {
                    if (v.phone === msg.to && c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({ ...msg, userName }));
                    }
                });
            } else if (msg.type === 'leave') {
                clients.delete(ws);
                broadcastUsers();
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        clients.delete(ws);
        broadcastUsers();
    });
});

function broadcastUsers() {
    const users = [...clients.values()].map(c => ({ phone: c.phone, name: c.name }));
    clients.forEach((_, c) => {
        if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'users-list', users }));
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('HelloSorft port ' + PORT));
