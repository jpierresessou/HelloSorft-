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

setInterval(async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('messages').delete().lt('expires_at', now);
    if (!error) console.log('🧹 Messages expirés supprimés');
}, 5 * 60 * 1000);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

wss.on('connection', (ws) => {
    let userPhone = null;
    let userName = null;

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'register') {
                userPhone = msg.phone; userName = msg.name;
                clients.set(ws, { phone: userPhone, name: userName });
                await supabase.from('users').upsert({ phone: userPhone, name: userName, password: msg.password || '', photo: msg.photo || null });
                ws.send(JSON.stringify({ type: 'register-success', phone: userPhone, name: userName }));
                broadcastUsers();
            }
            else if (msg.type === 'login') {
                const { data: user } = await supabase.from('users').select('*').eq('phone', msg.phone).single();
                if (user && user.password === msg.password) {
                    userPhone = msg.phone; userName = user.name;
                    clients.set(ws, { phone: userPhone, name: userName });
                    ws.send(JSON.stringify({ type: 'user-data', phone: user.phone, name: user.name, photo: user.photo || '', bio: user.bio || '', status: user.status || 'online' }));
                    broadcastUsers();
                } else { ws.send(JSON.stringify({ type: 'error', message: 'Numéro ou mot de passe incorrect' })); }
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
                ws.send(JSON.stringify({ type: 'contacts-list', contacts: contacts || [], users: [...clients.values()].map(c => ({ phone: c.phone, name: c.name })) }));
            }
            else if (msg.type === 'get-messages') {
                const { data: msgs } = await supabase.from('messages').select('*').or(`sender_phone.eq.${userPhone},receiver_phone.eq.${userPhone}`).order('created_at', { ascending: true });
                ws.send(JSON.stringify({ type: 'messages-list', messages: msgs || [] }));
            }
            else if (msg.type === 'update-profile') {
                const updates = { name: msg.name }; if (msg.password) updates.password = msg.password; if (msg.photo) updates.photo = msg.photo; if (msg.bio !== undefined) updates.bio = msg.bio; if (msg.status) updates.status = msg.status;
                await supabase.from('users').update(updates).eq('phone', userPhone);
                userName = msg.name; clients.set(ws, { phone: userPhone, name: userName });
                ws.send(JSON.stringify({ type: 'profile-updated', name: msg.name, photo: msg.photo || '', bio: msg.bio || '', status: msg.status || 'online' }));
            }
            else if (msg.type === 'delete-account') {
                await supabase.from('contacts').delete().eq('user_phone', userPhone);
                await supabase.from('contacts').delete().eq('contact_phone', userPhone);
                await supabase.from('messages').delete().or(`sender_phone.eq.${userPhone},receiver_phone.eq.${userPhone}`);
                await supabase.from('users').delete().eq('phone', userPhone);
                clients.delete(ws); ws.send(JSON.stringify({ type: 'account-deleted' })); broadcastUsers();
            }
            else if (msg.type === 'text-message' || msg.type === 'image-message' || msg.type === 'voice-message') {
                await supabase.from('messages').insert({
                    sender_phone: userPhone, receiver_phone: msg.to,
                    type: msg.type === 'text-message' ? 'text' : msg.type === 'image-message' ? 'image' : 'voice',
                    content: msg.text || null, image_url: msg.imageData || null, audio_url: msg.audioData || null,
                    expires_at: new Date(Date.now() + 86400000).toISOString()
                });
                clients.forEach((v, c) => { if (v.phone === msg.to && c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ ...msg, userName })); });
            }
            else if (msg.type === 'ptt-start' || msg.type === 'ptt-end' || msg.type === 'read' || msg.type === 'typing') {
                clients.forEach((v, c) => { if (v.phone === msg.to && c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ ...msg, userName })); });
            }
            else if (msg.type === 'leave') { clients.delete(ws); broadcastUsers(); }
        } catch (e) { console.error(e); }
    });
    ws.on('close', () => { clients.delete(ws); broadcastUsers(); });
});

function broadcastUsers() {
    const users = [...clients.values()].map(c => ({ phone: c.phone, name: c.name }));
    clients.forEach((_, c) => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'users-list', users })); });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('HelloSorft port ' + PORT));