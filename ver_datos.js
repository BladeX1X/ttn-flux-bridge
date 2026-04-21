import Database from 'better-sqlite3';

const db = new Database('datos.db');

console.log('\n--- ÚLTIMAS 10 LECTURAS EN LA BASE DE DATOS ---\n');

const rows = db.prepare('SELECT id, timestamp, distance_mm, battery_mv FROM lecturas ORDER BY id DESC LIMIT 10').all();

console.table(rows);

console.log('\nTip: Para ver el JSON completo de una lectura, usa un visor de SQLite como DB Browser.');
