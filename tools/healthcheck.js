const { request } = require('undici');

function getPort() {
    return parseInt(process.env.NODE_PORT || '53032');
}

function useSSL() {
    return process.env.USE_SSL === 'true';
}

void (async () => {
    let port = getPort();
    let url = `http${useSSL() ? 's' : ''}://127.0.0.1:${port}/.well-known/nox`;
    try {
        let response = await request(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Nox Healthcheck',
                'Accept': 'application/json',
            },
        });

        if (response.statusCode !== 200) {
            let text = await response.body.text();
            console.error(`Error: ${response.statusCode} ${text}`);
            process.exit(1);
        }

        let json = await response.body.json();
        if (json.status === "online") {
            console.log(`Nox is online`);
            process.exit(0);
        }

    } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
})();