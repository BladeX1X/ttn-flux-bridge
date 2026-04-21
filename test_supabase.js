import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cyznlhlrocbiekkyrqtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5em5saGxyb2NiaWVra3lycXRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzM5NjEsImV4cCI6MjA5MjMwOTk2MX0.IxVgMv8-x83th5TPCAtkxnlIEqA6-8rgPB_8E-AU7R8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testInsert() {
    console.log('🚀 Enviando dato de prueba a Supabase...');
    
    const { data, error } = await supabase
        .from('lecturas')
        .insert([
            { 
                device_id: 'TEST_NODE_ESM', 
                distance_mm: 9999.9, 
                battery_mv: 4200, 
                payload_completo: { info: "Prueba ESM exitosa" } 
            }
        ])
        .select();

    if (error) {
        console.error('❌ ERROR:', error.message);
    } else {
        console.log('✅ ¡ÉXITO! Dato insertado correctamente:');
        console.table(data);
    }
}

testInsert();
