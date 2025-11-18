// questo script permetterà di scegliere la conigurazione con cui lanciare koa-classic-server al ine di essere testato 
// ci sarà una lista interattive di configurazione fra cui scegliere :

// chooseCon.js
const { createServer, configurations } = require('../customTest/serversToLoad.util');
const inquirer = require('inquirer').default;

async function chooseConfiguration() {
  // Costruiamo le scelte dall'array delle configurazioni
  const choices = configurations.map(config => ({
    name: `${config.name}: ${config.description}`,
    value: config.name,
  }));

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'configName',
      message: 'Seleziona la configurazione da visualizzare:',
      choices: choices,
    },
  ]);

  return answers.configName;
}

async function main() {
  const configName = await chooseConfiguration();
  const app = createServer(configName);
  const port = process.env.PORT || 3000;
  
  app.listen(port, () => {
    console.log(`Server avviato su http://localhost:${port} con configurazione "${configName}"`);
  });
}

main().catch(error => {
  console.error('Errore durante l\'esecuzione:', error);
  process.exit(1);
});

