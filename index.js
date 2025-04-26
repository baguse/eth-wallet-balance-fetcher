const https = require("https");
const { GoldRushClient, ChainName } = require("@covalenthq/client-sdk");
const { program } = require("commander");

require("dotenv").config();
const { BAYC_CONTRACT, COVALENT_API_KEY, RPC_API_KEY } = process.env;

const ETH_RPC_URL = `https://mainnet.infura.io/v3/${RPC_API_KEY}`;

const client = new GoldRushClient(COVALENT_API_KEY, {
  enableRetry: true,
  maxRetries: 5,
  threadCount: 3,
  retryDelay: 100,
  // debug: true,
});

function rpcRequest(method, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(ETH_RPC_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const json = JSON.parse(data);
        if (json.error) reject(json.error);
        else resolve(json.result);
      });
    });

    req.on("error", reject);

    req.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      })
    );

    req.end();
  });
}

function sleep(time) {
  return new Promise((resolve, reject) => setTimeout(() => resolve(), time));
}

async function getBlockByTimestamp(target) {
  let low = 16000000;
  let high = await rpcRequest("eth_blockNumber", []);
  high = parseInt(high, 16);
  let h = {};
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const block = await rpcRequest("eth_getBlockByNumber", ["0x" + mid.toString(16), false]);
    const ts = parseInt(block.timestamp, 16);
    if (ts < target) low = mid + 1;
    else {
      h = block;
      high = mid - 1;
    }
  }

  return high;
}

async function getBAYCHoldersAtBlock(block) {
  const request = client.BalanceService.getTokenHoldersV2ForTokenAddress(ChainName.ETH_MAINNET, BAYC_CONTRACT, {
    blockHeight: block,
    pageSize: 1000,
  });
  const holders = [];
  for await (const result of request) {
    holders.push(...result.data.items.map((item) => item.address));
  }

  return holders;
}

async function getETHBalanceAtBlock(address, block) {
  const balances = await client.BalanceService.getHistoricalTokenBalancesForWalletAddress(ChainName.ETH_MAINNET, address, {
    blockHeight: block,
  });

  const ethItem = balances.data.items.find((item) => item.contract_ticker_symbol === "ETH");
  return ethItem ? parseFloat(ethItem.balance) / 1e18 : 0; // convert from wei to ETH
}

const walletAndBalanceFetcher = async (date, options) => {
  let parsedDate;

  const format1Regex = /\b\d{4}-\d{2}-\d{2}\b/g;
  const format2Regex = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\b/g;
  const format3Regex = /\b\d{10}\b/g;
  const format4Regex = /\b\d{13}\b/g;

  if (format1Regex.test(date) || format2Regex.test(date)) {
    parsedDate = new Date(date);
  } else if (format3Regex.test(date)) {
    parsedDate = new Date(Number(`${date}000`));
  } else if (format4Regex.test(date)) {
    parsedDate = new Date(Number(date));
  } else {
    console.log("Invalid date format, please use date format YYYY-MM-DDD, YYYY-MM-DDTHH:mm:ssZ, or an epoch time using UNIX standard");
    return;
  }

  console.log(`Using date: ${parsedDate.toLocaleString()}`);
  try {
    const epochTime = parseInt(parsedDate.getTime() / 1000);
    console.log("Finding block number at timestamp:", epochTime);
    const block = await getBlockByTimestamp(epochTime);
    console.log("Using block number:", block);

    const holders = await getBAYCHoldersAtBlock(block);
    console.log("Total Holders:", holders.length);

    let total = 0;
    let index = 1;
    const deadAddresses = ["0x000000000000000000000000000000000000dead"]; // skip for dead address bcs it will always timeout
    for (const addr of holders) {
      if (!deadAddresses.includes(addr)) {
        const balance = await getETHBalanceAtBlock(addr, block);
        await sleep(500); // to avoid the rate limiter of NGINX
        console.log(`${index}) ${addr}: ${balance.toFixed(6)} ETH`);
        total += balance;
        index += 1;
      }
    }

    console.log(`Total ETH: ${total.toFixed(6)} ETH`);
  } catch (e) {
    console.log({
      file: "index.js",
      line: 94,
      e,
    });
  }
};

program
  .name("BAYC Wallet and Balance fetcher")
  .argument("<date>", "The date you want to search for in YYYY-MM-DD or with full timestamp YYYY-MM-DDTHH:mm:ssZ")
  .action(walletAndBalanceFetcher);

program.parse();
