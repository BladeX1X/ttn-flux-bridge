import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Layers,
  Settings2,
  Code,
  Plus,
  Trash2,
  X,
  Send,
  Bot,
  User as UserIcon,
  MessageSquare
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

const App: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [latestPayload, setLatestPayload] = useState<any>(null);
  const [availableVars, setAvailableVars] = useState<string[]>(['distance_mm', 'battery_mv']);
  const [selectedVars, setSelectedVars] = useState<string[]>(['distance_mm', 'battery_mv']);
  const [connections, setConnections] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  // IA Chat States
  const [messages, setMessages] = useState<any[]>([{ role: 'bot', text: '¡Hola! Soy tu asistente TTN-FLUX. ¿Quieres que analice tus datos?' }]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [newConn, setNewConn] = useState({ nombre: '', host: 'nam1.cloud.thethings.network', port: 1883, username: '', password: '', topic: 'v3/+/devices/+/up' });

  useEffect(() => {
    // Conexión al Bridge en la Nube (Render)
    const socket = new WebSocket('wss://ttn-flux-bridge.onrender.com');
    setWs(socket);
    socket.onopen = () => setIsConnected(true);
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'INIT') {
        setConnections(msg.connections);
        setData(msg.history);
        updateAvailableVars(msg.history);
      } else if (msg.type === 'UPDATE') {
        setData(prev => [...prev.slice(-49), msg.data]);
        setLatestPayload(msg.full_payload);
        updateAvailableVars([msg.data]);
      } else if (msg.type === 'CHAT_RESPONSE') {
        setMessages(prev => [...prev, { role: 'bot', text: msg.text }]);
        setIsTyping(false);
      }
    };
    return () => socket.close();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateAvailableVars = (batch: any[]) => {
    setAvailableVars(prev => {
      const keys = new Set(prev);
      batch.forEach(row => {
        Object.keys(row).forEach(key => {
          if (!['time', 'device_id', 'fullTime'].includes(key) && typeof row[key] === 'number') keys.add(key);
        });
      });
      return Array.from(keys);
    });
  };

  const sendMessage = () => {
    if (!inputText.trim() || !ws) return;
    setMessages(prev => [...prev, { role: 'user', text: inputText }]);
    ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', text: inputText }));
    setInputText('');
    setIsTyping(true);
  };

  const deleteConnection = (id: number) => ws?.send(JSON.stringify({ type: 'DELETE_CONNECTION', id }));

  const colors: Record<string, string> = { distance_mm: '#3b82f6', battery_mv: '#10b981', rssi: '#f59e0b', snr: '#ef4444' };
  const latest = data.length > 0 ? data[data.length - 1] : {};

  return (
    <div className="app-container">
      <header>
        <div className="logo"><Activity size={28} color="#3b82f6" /> TTN <span>FLUX</span></div>
        <div style={{display: 'flex', gap: '1rem'}}>
          <button className="add-btn" onClick={() => setShowModal(true)}><Plus size={18} /> Añadir Dispositivo</button>
          <div className="status-badge"><div className={`status-dot ${isConnected ? 'online' : ''}`} />{isConnected ? 'SISTEMA ACTIVO' : 'RECONECTANDO...'}</div>
        </div>
      </header>

      <main>
        <div className="grid-layout">
          <div className="main-content">
            <div className="metrics-row" style={{gridColumn: 'span 12', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginBottom: '1rem'}}>
              {connections.map(c => (
                <div className="card connection-card" key={c.id}>
                  <div style={{display: 'flex', justifyContent: 'space-between'}}><div className="card-title">{c.nombre || 'Sin nombre'}</div><Trash2 size={14} className="delete-icon" onClick={() => deleteConnection(c.id)} /></div>
                  <div style={{fontSize: '0.75rem', opacity: 0.5}}>{c.host}</div>
                </div>
              ))}
            </div>

            <div className="metrics-row" style={{ gridColumn: 'span 12', gridTemplateColumns: `repeat(${Math.min(4, selectedVars.length || 1)}, 1fr)` }}>
              {selectedVars.map(v => (
                <div className="card" key={v}>
                  <div className="card-title" style={{color: colors[v] || '#8b5cf6'}}>{v?.replace('_', ' ').toUpperCase()}</div>
                  <div className="metric-value">{latest[v] !== undefined ? latest[v].toFixed(latest[v] > 100 || latest[v] < -20 ? 0 : 2) : '0'}</div>
                </div>
              ))}
            </div>

            {selectedVars.map(v => (
              <div className="card chart-container" key={v} style={{gridColumn: 'span 12', height: '350px'}}>
                <div className="card-title">Historial de {v?.replace('_', ' ')}</div>
                <div style={{ width: '100%', height: '250px', marginTop: '1rem' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                      <defs><linearGradient id={`color${v}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={colors[v] || '#8b5cf6'} stopOpacity={0.2}/><stop offset="95%" stopColor={colors[v] || '#8b5cf6'} stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="time" stroke="#666" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#666" fontSize={12} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: 'none', borderRadius: '12px', color: '#fff' }} />
                      <Area type="monotone" dataKey={v} stroke={colors[v] || '#8b5cf6'} strokeWidth={3} fillOpacity={1} fill={`url(#color${v})`} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>

          <aside className="sidebar">
            <section>
              <div className="section-title"><Settings2 size={14} /> VARIABLES</div>
              {availableVars.map(v => (
                <div key={v} className={`var-item ${selectedVars.includes(v) ? 'active' : ''}`} onClick={() => setSelectedVars(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}>
                  <div style={{fontSize: '0.85rem'}}>{v?.replace('_', ' ')}</div>
                  <input type="checkbox" checked={selectedVars.includes(v)} readOnly />
                </div>
              ))}
            </section>
            
            {/* IA Chat Section */}
            <section className="chat-section">
              <div className="section-title"><MessageSquare size={14} /> ASISTENTE IA</div>
              <div className="chat-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`message ${m.role}`}>
                    <div className="message-header">
                      {m.role === 'bot' ? <Bot size={12} /> : <UserIcon size={12} />}
                      {m.role === 'bot' ? 'TTN-FLUX AI' : 'USUARIO'}
                    </div>
                    <div className="message-text">{m.text}</div>
                  </div>
                ))}
                {isTyping && (
                  <div className="typing-indicator">
                    <Bot size={12} className="connecting" /> TTN-FLUX está analizando...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input-wrapper">
                <div className="chat-input-container">
                  <input 
                    type="text" 
                    placeholder="Pregunta sobre tus datos..." 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  />
                  <button className="chat-send-btn" onClick={sendMessage}><Send size={16} /></button>
                </div>
              </div>
            </section>

            <section>
              <div className="section-title"><Code size={14} /> LIVE PAYLOAD</div>
              <div className="json-viewer" style={{maxHeight: '300px'}}>
                {latestPayload ? JSON.stringify(latestPayload, null, 2) : '// Esperando...'}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* Modal Connection */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '2rem'}}><h2 style={{margin: 0}}>Nueva Conexión</h2><X className="close-icon" onClick={() => setShowModal(false)} /></div>
            <div className="form-group"><label>Nombre</label><input type="text" value={newConn.nombre} onChange={e => setNewConn({...newConn, nombre: e.target.value})} /></div>
            <div className="form-group"><label>Host</label><input type="text" value={newConn.host} onChange={e => setNewConn({...newConn, host: e.target.value})} /></div>
            <div className="form-group"><label>Username</label><input type="text" value={newConn.username} onChange={e => setNewConn({...newConn, username: e.target.value})} /></div>
            <div className="form-group"><label>Password</label><input type="password" value={newConn.password} onChange={e => setNewConn({...newConn, password: e.target.value})} /></div>
            <div className="form-group"><label>Topic</label><input type="text" value={newConn.topic} onChange={e => setNewConn({...newConn, topic: e.target.value})} /></div>
            <button className="submit-btn" onClick={() => { ws?.send(JSON.stringify({ type: 'ADD_CONNECTION', data: newConn })); setShowModal(false); }}>Guardar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
