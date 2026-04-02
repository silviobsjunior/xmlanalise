const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        console.log("Checking product...");
        const prod = await pool.query("SELECT * FROM produtos_nfe WHERE codigo_barras = '7891790433283'");
        console.log("Product in produtos_nfe:", prod.rows);

        if (prod.rows.length > 0) {
            const nfe_id = prod.rows[0].nfe_id;
            console.log(`Checking nfe_id ${nfe_id}...`);
            const ni = await pool.query("SELECT * FROM nfe_importadas WHERE id = $1", [nfe_id]);
            console.log("nfe_importadas:", ni.rows);

            if (ni.rows.length > 0) {
                const chave = ni.rows[0].chave_acesso;
                const nf = await pool.query("SELECT * FROM notas_fiscais WHERE chave_acesso = $1", [chave]);
                console.log("notas_fiscais:", nf.rows);
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

check();
