const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SUPABASE_URL = 'https://fxlvovlepjjffjgwifej.supabase.co';
const SUPABASE_SERVICE_KEY = 'VOTRE_CLE_SERVICE_ROLE';
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
            console.log('Message reçu:', msg.type, msg.phone);

            // INSCRIPTION
            if (msg.type === 'register') {
                userPhone = msg.phone;
                userName = msg.name;
                clients.set(ws, { phone: userPhone, name: userName });

                const { error } = await supabase
                    .from('users')
                    .upsert({ phone: userPhone, name: userName, password: msg.password || '' });

                if (error) {
                    console.error('Erreur inscription:', error);
                    ws.send(JSON.stringify({ type: 'error', message: 'Erreur inscription' }));
                } else {
                    console.log('Utilisateur enregistré:', userPhone);
                    ws.send(JSON.stringify({ type: 'register-success', phone: userPhone }));
                    broadcastUsers();
                }
            }

            // CONNEXION
            else if (msg.type === 'join') {
                userPhone = msg.phone;
                userName = msg.name || msg.phone;
                clients.set(ws, { phone: userPhone, name: userName });
                console.log('Utilisateur connecté:', userPhone);
                ws.send(JSON.stringify({ type: 'join-success' }));
                broadcastUsers();
            }

            // VÉRIFIER UN CONTACT
            else if (msg.type === 'check-contact') {
                console.log('Vérification contact:', msg.phone);
                const { data: user, error } = await supabase
                    .from('users')
                    .select('phone, name')
                    .eq('phone', msg.phone)
                    .single();

                if (user) {
                    console.log('Contact trouvé:', user.name);
                    // Ajouter dans les contacts
                    await supabase.from('contacts').upsert({
                        user_phone: userPhone,
                        contact_phone: msg.phone,
                        contact_name: user.name
                    });
                    ws.send(JSON.stringify({
                        type: 'contact-check',
                        isHellosorft: true,
                        phone: msg.phone,
                        userName: user.name
                    }));
                } else {
                    console.log('Contact non trouvé:', msg.phone);
                    ws.send(JSON.stringify({
                        type: 'contact-check',
                        isHellosorft: false,
                        phone: msg.phone
                    }));
                }
            }

            // RÉCUPÉRER MES CONTACTS
            else if (msg.type === 'get-contacts') {
                const { data: contacts } = await supabase
                    .from('contacts')
                    .select('*')
                    .eq('user_phone', userPhone);

                const contactsWithStatus = (contacts || []).map(c => ({
                    ...c,
                    online: [...clients.values()].some(cl => cl.phone === c.contact_phone)
                }));

                ws.send(JSON.stringify({ type: 'contacts-list', contacts: contactsWithStatus }));
            }

            // RELAYER MESSAGES
            else if (msg.type === 'text-message' || msg.type === 'image-message' || msg.type === 'voice-message') {
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
            }

            // PTT START/END
            else if (msg.type === 'ptt-start' || msg.type === 'ptt-end') {
                clients.forEach((v, c) => {
                    if (v.phone === msg.to && c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({ ...msg, userName }));
                    }
                });
            }

            // DÉCONNEXION
            else if (msg.type === 'leave') {
                clients.delete(ws);
                broadcastUsers();
            }
        } catch (e) {
            console.error('Erreur:', e);
        }
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
