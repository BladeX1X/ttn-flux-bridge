import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import http from 'http';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';

// 1. Configuración de Servicios (100% via Environment Variables)
const supabaseUrl = process.env.SUPABASE_URL || 'https://cyznlhlrocbiekkyrqtm.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY; 
const supabase = createClient(supabaseUrl, supabaseKey);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 2. Servidor HTTP + WebSocket
const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('TTN-FLUX Bridge is Online 🚀'); }
});
const wss = new WebSocketServer({ server });

const db = new Database('datos.db');
db.prepare(`CREATE TABLE IF NOT EXISTS lecturas (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, device_id TEXT, distance_mm REAL, battery_mv REAL, payload_completo TEXT)`).run();

const insertLocal = db.prepare(`INSERT INTO lecturas (device_id, distance_mm, battery_mv, payload_completo) VALUES (?, ?, ?, ?)`);
const activeClients = new Map();

function broadcast(msg) { wss.clients.forEach(client => { if (client.readyState === 1) client.send(JSON.stringify(msg)); }); }

async function startMqttClient(config) {
    const clientId = (config.id || 'default').toString();
    if (activeClients.has(clientId)) activeClients.get(clientId).end();
    
    const client = mqtt.connect(`mqtt://${config.host}:${config.port}`, { username: config.username, password: config.password });
    client.on('connect', () => { 
        client.subscribe(config.topic); 
        console.log(`✅ [${config.nombre || 'Principal'}] Conectado a TTN`); 
    });
    
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
    activeClients.set(clientId, client);
}

// CONEXIÓN POR DEFECTO (Desde Variables de Entorno)
const DEFAULT_CONN = {
    id: 999,
    nombre: "Flujómetro Principal",
    host: process.env.TTN_HOST || "nam1.cloud.thethings.network",
    port: parseInt(process.env.TTN_PORT || "1883"),
    username: process.env.TTN_USERNAME,
    password: process.env.TTN_PASSWORD,
    topic: process.env.TTN_TOPIC || "v3/+/devices/+/up"
};

wss.on('connection', async (ws) => {
    const { data: history } = await supabase.from('lecturas').select('*').order('id', { ascending: false }).limit(50);
    const { data: connections } = await supabase.from('conexiones').select('*');
    
    ws.send(JSON.stringify({ 
        type: 'INIT', 
        connections: connections?.length > 0 ? connections : [DEFAULT_CONN], 
        history: (history || []).reverse().map(h => {
            const p = typeof h.payload_completo === 'string' ? JSON.parse(h.payload_completo) : h.payload_completo;
            return { time: new Date(h.created_at || h.timestamp).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" }), device_id: h.device_id, ...(p?.uplink_message?.decoded_payload || {}) };
        })
    }));

    ws.on('message', async (msg) => {
        const cmd = JSON.parse(msg);
        if (cmd.type === 'CHAT_MESSAGE') {
            try {
                const now = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
                const sqlPlanner = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: `Eres un Senior PostgreSQL Data Scientist experto en IoT.
                        SCHEMA: Tabla 'lecturas' {id, created_at, device_id, distance_mm, battery_mv}.
                        REGLAS TÉCNICAS:
                        1. Usa sintaxis PostgreSQL estándar (SELECT, AVG, MAX, MIN).
                        2. No mezcles columnas individuales con funciones de agregado (como AVG) sin GROUP BY.
                        3. Para registros recientes: SELECT * FROM lecturas ORDER BY created_at DESC LIMIT X.
                        4. Filtros de tiempo: 'now() - interval 'X hours/days/minutes''.
                        4. Si pides registros individuales, usa ORDER BY created_at DESC LIMIT 50.
                        5. Maneja nulos con COALESCE si es necesario.
                        RESPUESTA: Solo JSON {"sql": "...", "is_greeting": false}. JSON.` },
                        { role: "user", content: cmd.text }
                    ],
                    model: "llama-3.1-8b-instant",
                    response_format: { type: "json_object" }
                });
                const aiRawResponse = sqlPlanner.choices[0].message.content;
                console.log("🤖 IA RESPONDIO:", aiRawResponse);
                const plan = JSON.parse(aiRawResponse);

                if (plan?.is_greeting || !plan?.sql) {
                    const greeting = await groq.chat.completions.create({
                        messages: [{ role: "system", content: "Eres TTN-FLUX AI. Saluda corto." }, { role: "user", content: cmd.text }],
                        model: "llama-3.1-8b-instant",
                    });
                    ws.send(JSON.stringify({ type: 'CHAT_RESPONSE', text: greeting.choices[0].message.content }));
                    return;
                }

                const sqlQuery = plan.sql.toString().replace(/;$/, ""); 
                console.log("📡 SQL EJECUTANDO:", sqlQuery);
                
                const { data: dbResult, error } = await supabase.rpc('consulta_inteligente', { sql_query: sqlQuery });
                if (error) throw error;

                const humanizer = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "Eres TTN-FLUX AI. Responde en una sola frase corta y profesional." },
                        { role: "user", content: `PREGUNTA: ${cmd.text}. DATOS: ${JSON.stringify(dbResult?.slice(0,5))}` }
                    ],
                    model: "llama-3.1-8b-instant",
                });
                ws.send(JSON.stringify({ type: 'CHAT_RESPONSE', text: humanizer.choices[0].message.content }));
            } catch (e) {
                console.error('❌ ERROR DETALLADO IA:', e.message);
                ws.send(JSON.stringify({ type: 'CHAT_RESPONSE', text: "Error procesando consulta: " + e.message }));
            }
        }
    });
});

async function init() {
    const { data: connections } = await supabase.from('conexiones').select('*');
    if (connections && connections.length > 0) {
        connections.forEach(startMqttClient);
    } else {
        if (DEFAULT_CONN.username && DEFAULT_CONN.password) {
            startMqttClient(DEFAULT_CONN);
        } else {
            console.log("⚠️ Sin credenciales TTN configuradas.");
        }
    }
}
init();

server.listen(port, () => { console.log(`🚀 Bridge 100% Cloud (Clean) en puerto ${port}`); });
