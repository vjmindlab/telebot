const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const { Connection, clusterApiUrl, PublicKey } = require("@solana/web3.js");
const admin = require("firebase-admin");

// Initialize Firebase Admin from service account JSON stored in env variable
const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(BOT_TOKEN); // no polling, we'll use webhook
const connection = new Connection(clusterApiUrl("mainnet-beta"));

// Helper: Create Progress Bar
function createProgressBar(current, goal, barLength = 20) {
  const percentage = Math.min(current / goal, 1);
  const filledBars = Math.floor(percentage * barLength);
  const emptyBars = barLength - filledBars;

  const filled = "█".repeat(filledBars);
  const empty = "░".repeat(emptyBars);
  return `[${filled}${empty}] ${current.toFixed(2)}/${goal} SOL`;
}

// Returns a reference to a document for a given chatId
function userDoc(chatId) {
  return db.collection("users").doc(chatId.toString());
}

// Handle incoming messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text.startsWith("/start")) {
    bot.sendMessage(chatId, "Welcome! Use /setwallet <public_key> to set your wallet, /setgoal <amount> to set your SOL goal, and /balance to check progress.");
  } else if (text.startsWith("/setwallet")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      bot.sendMessage(chatId, "Usage: /setwallet <wallet_public_key>");
      return;
    }
    const wallet = parts[1].trim();
    try {
      new PublicKey(wallet); // Validate wallet
      await userDoc(chatId).set({ wallet }, { merge: true });
      bot.sendMessage(chatId, `Wallet set to: ${wallet}`);
    } catch (err) {
      bot.sendMessage(chatId, "Invalid wallet address. Please try again.");
    }
  } else if (text.startsWith("/setgoal")) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      bot.sendMessage(chatId, "Usage: /setgoal <amount>");
      return;
    }
    const goalNum = parseFloat(parts[1]);
    if (isNaN(goalNum) || goalNum <= 0) {
      bot.sendMessage(chatId, "Please provide a valid goal (a positive number).");
      return;
    }
    await userDoc(chatId).set({ goal: goalNum }, { merge: true });
    bot.sendMessage(chatId, `Goal set to: ${goalNum} SOL`);
  } else if (text.startsWith("/balance")) {
    const doc = await userDoc(chatId).get();
    if (!doc.exists || !doc.data().wallet || !doc.data().goal) {
      bot.sendMessage(chatId, "Please set your wallet and goal first using /setwallet and /setgoal.");
      return;
    }

    const { wallet, goal } = doc.data();
    try {
      const pubKey = new PublicKey(wallet);
      const balanceLamports = await connection.getBalance(pubKey);
      const balanceSol = balanceLamports / 1e9;
      const bar = createProgressBar(balanceSol, goal);
      bot.sendMessage(chatId, `Your current SOL balance:\n${bar}`);
    } catch (error) {
      console.error("Error fetching balance:", error);
      bot.sendMessage(chatId, "Error fetching balance. Check the wallet address or try again later.");
    }
  }
});

// Setup Express for handling the webhook
const app = express();
app.use(bodyParser.json());

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Bot server is running on port ${PORT}`);

  // Optional: You can set the webhook automatically after deployment
  // Just replace <your-render-url> with the actual URL of your deployed service.
  // For example: https://my-telegram-bot.onrender.com
  //
  // await bot.setWebHook(`https://<your-render-url>/webhook`);
});
