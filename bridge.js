import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import http from 'http';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';

// 1. Configuración de Servicios (Producción)
const supabaseUrl = process.env.SUPABASE_URL || 'https://cyznlhlrocbiekkyrqtm.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY; 
const supabase = createClient(supabaseUrl, supabaseKey);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 2. Servidor HTTP + WebSocket (Keep-Alive)
const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('TTN-FLUX Bridge is Online 🚀');
    }
});
const wss = new WebSocketServer({ server });

const db = new Database('datos.db');
db.prepare(`CREATE TABLE IF NOT EXISTS conexiones (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, host TEXT, port INTEGER, username TEXT, password TEXT, topic TEXT)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS lecturas (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, device_id TEXT, distance_mm REAL, battery_mv REAL, payload_completo TEXT)`).run();

const insertLocal = db.prepare(`INSERT INTO lecturas (device_id, distance_mm, battery_mv, payload_completo) VALUES (?, ?, ?, ?)`);
const activeClients = new Map();

function broadcast(msg) { wss.clients.forEach(client => { if (client.readyState === 1) client.send(JSON.stringify(msg)); }); }

async function startMqttClient(config) {
    if (activeClients.has(config.id)) activeClients.get(config.id).end();
    const client = mqtt.connect(`mqtt://${config.host}:${config.port}`, { username: config.username, password: config.password });
    client.on('connect', () => { client.subscribe(config.topic); console.log(`✅ [${config.nombre}] Conectado`); });
    client.on('message', async (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            const decoded = payload.uplink_message?.decoded_payload || {};
            const deviceId = payload.end_device_ids?.device_id || 'unknown';
            await supabase.from('lecturas').insert([{ device_id: deviceId, distance_mm: decoded.distance_mm, battery_mv: decoded.battery_mv, payload_completo: payload }]);
            insertLocal.run(deviceId, decoded.distance_mm, decoded.battery_mv, JSON.stringify(payload));
            broadcast({ type: 'UPDATE', data: { time: new Date().toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" }), device_id: deviceId, ...decoded }, full_payload: payload });
        } catch (e) { console.error(`❌ Error MQTT:`, e.message); }
    });
    activeClients.set(config.id, client);
}

wss.on('connection', async (ws) => {
    const { data: history } = await supabase.from('lecturas').select('*').order('id', { ascending: false }).limit(50);
    ws.send(JSON.stringify({ type: 'INIT', connections: db.prepare('SELECT * FROM conexiones').all(), history: (history || []).reverse().map(h => {
        const p = typeof h.payload_completo === 'string' ? JSON.parse(h.payload_completo) : h.payload_completo;
        return { time: new Date(h.created_at || h.timestamp).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" }), device_id: h.device_id, ...(p?.uplink_message?.decoded_payload || {}) };
    })}));

    ws.on('message', async (msg) => {
        const cmd = JSON.parse(msg);
        
        if (cmd.type === 'CHAT_MESSAGE') {
            try {
                // PASO 1: PLANIFICADOR (Con hora de México)
                const now = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
                const sqlPlanner = await groq.chat.completions.create({
                    messages: [
                        { 
                            role: "system", 
                            content: `Eres TTN-FLUX Expert. Hoy es ${now}.
                            MISIÓN: Determina si el usuario quiere datos o solo charlar.
                            REGLAS:
                            1. Si el usuario saluda o charla (ej: "Hola"), responde con {"sql": null, "is_greeting": true}.
                            2. Si pide datos, genera un SQL para la tabla 'lecturas' (id, created_at, device_id, distance_mm, battery_mv).
                            3. Usa siempre LIMIT 50.
                            Responde SOLO con JSON.` 
                        },
                        { role: "user", content: cmd.text }
                    ],
                    model: "llama-3.3-70b-versatile",
                    response_format: { type: "json_object" }
                });

                const plan = JSON.parse(sqlPlanner.choices[0].message.content);

                if (plan.is_greeting) {
                    const greeting = await groq.chat.completions.create({
                        messages: [{ role: "system", content: "Eres TTN-FLUX AI. Saluda al usuario de forma profesional y dile que estás listo para analizar sus flujómetros." }, { role: "user", content: cmd.text }],
                        model: "llama-3.3-70b-versatile",
                    });
                    ws.send(JSON.stringify({ type: 'CHAT_RESPONSE', text: greeting.choices[0].message.content }));
                    return;
                }

                let sqlQuery = plan.sql;
                sqlQuery = sqlQuery.replace(/;$/, ""); 
                console.log(`📡 SQL GENERADO: ${sqlQuery}`);

                const { data: dbResult, error } = await supabase.rpc('consulta_inteligente', { sql_query: sqlQuery });
                if (error) throw error;

                const truncatedData = dbResult && dbResult.length > 20 ? dbResult.slice(0, 20) : dbResult;
                const totalCount = dbResult ? dbResult.length : 0;

                const humanizer = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "Eres TTN-FLUX AI. Tu misión es dar respuestas extremadamente cortas, claras y profesionales. Responde en una sola frase si es posible. No uses introducciones innecesarias." },
                        { role: "user", content: `PREGUNTA: ${cmd.text}. TOTAL REGISTROS: ${totalCount}. MUESTRA DE DATOS: ${JSON.stringify(truncatedData)}` }
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                ws.send(JSON.stringify({ type: 'CHAT_RESPONSE', text: humanizer.choices[0].message.content }));

            } catch (error) {
                console.error('❌ ERROR QUERY AI:', error.message);
                ws.send(JSON.stringify({ type: 'CHAT_RESPONSE', text: "Lo siento, no pude procesar esa consulta compleja. Intenta preguntar de otra forma." }));
            }
        }
    });
});

db.prepare('SELECT * FROM conexiones').all().forEach(startMqttClient);
server.listen(port, () => {
    console.log(`🚀 Motor SQL + Keep-Alive Activo en puerto ${port}`);
});
