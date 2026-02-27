/**
 * Telegram Auto-Messaging Bot
 * Sends messages to groups from your account
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { config } from "./config.js";
import { Api } from "telegram/tl/index.js";

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionDir = path.join(__dirname, config.sessionDir);
const sessionFile = path.join(sessionDir, "session.txt");

// Create session directory if it doesn't exist
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

// Read or create session (prefer env for deployments like Railway)
let sessionString = process.env.SESSION_STRING || "";
if (!sessionString && fs.existsSync(sessionFile)) {
  sessionString = fs.readFileSync(sessionFile, "utf-8");
}

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const phoneNumber = process.env.PHONE_NUMBER;

console.log("\n🔧 Configuration Check:");
console.log(`  API_ID: ${apiId}`);
console.log(`  API_HASH: ${apiHash ? "✓ Set" : "✗ Missing"}`);
console.log(`  Phone: ${phoneNumber ? "✓ Set" : "✗ Missing"}`);

if (!apiId || !apiHash || !phoneNumber) {
  console.error("❌ Missing environment variables. Check your .env file!");
  process.exit(1);
}

const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  {
    connectionRetries: 5,
  }
);

// Function to save session
const saveSession = () => {
  const sessionStr = client.session.save();
  fs.writeFileSync(sessionFile, sessionStr);
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Detect non-interactive/headless environments (e.g. Railway)
const isHeadless =
  !!process.env.RAILWAY_ENVIRONMENT || process.env.HEADLESS === "1";

// Helper function to prompt user
const question = (prompt) => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
};

// Helper function to sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Store active auto-send timers
const activeTimers = [];

// Per-user autosend wizard state
const autosendStates = new Map(); // key: senderId string -> { step, groups, intervalText, done }

// Parse interval text like "30s", "5m", "4h" (default h)
const parseIntervalText = (intervalText) => {
  const trimmed = (intervalText || "").trim();
  const match = trimmed.match(/^(\d*\.?\d+)\s*([smhSMH]?)$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = (match[2] || "h").toLowerCase();
  if (!value || value <= 0) return null;

  let intervalMs;
  if (unit === "s") {
    intervalMs = value * 1000;
  } else if (unit === "m") {
    intervalMs = value * 60 * 1000;
  } else {
    intervalMs = value * 60 * 60 * 1000;
  }

  return {
    value,
    unit,
    intervalMs,
    label: `${value}${unit}`,
  };
};

// Helper to create and register an auto-send timer
const createAutoSendTimer = (groups, intervalInfo, message) => {
  const safeGroups = groups.map((g) => g.trim()).filter((g) => g);
  const { intervalMs, label } = intervalInfo;

  const timer = setInterval(async () => {
    console.log(`\n⏰ Auto-send tick: ${safeGroups.length} groups every ${label}`);
    for (let i = 0; i < safeGroups.length; i++) {
      const group = safeGroups[i];
      console.log(`[auto ${i + 1}/${safeGroups.length}] ${group}`);
      await sendMessageToGroup(group, message);
      if (i < safeGroups.length - 1) await sleep(config.messageDelay);
    }
  }, intervalMs);

  activeTimers.push(timer);
  return timer;
};

// Process step-by-step /autosend wizard input
const processAutosendWizardInput = async (senderKey, state, text, msg) => {
  const trimmedText = (text || "").trim();

  if (state.step === "groups") {
    const groups = trimmedText.split(" ").map((g) => g.trim()).filter((g) => g);
    if (!groups.length) {
      await msg.respond({ message: "❌ Please send at least one group username or ID (separated by spaces)." });
      return;
    }
    state.groups = groups;
    state.step = "interval";
    await msg.respond({
      message: `✅ Groups set: ${groups.join(", ")}\n\nStep 2: Send interval (e.g. 30s, 5m, 4h).`,
    });
    return;
  }

  if (state.step === "interval") {
    const intervalInfo = parseIntervalText(trimmedText);
    if (!intervalInfo) {
      await msg.respond({
        message: "❌ Invalid interval. Use formats like 30s, 5m, 4h (number + unit).",
      });
      return;
    }
    state.intervalText = trimmedText;
    state.intervalInfo = intervalInfo;
    state.step = "message";
    await msg.respond({
      message: `✅ Interval set to every ${intervalInfo.label}.\n\nStep 3: Send the message text to auto-send.`,
    });
    return;
  }

  if (state.step === "message") {
    if (!trimmedText) {
      await msg.respond({ message: "❌ Message cannot be empty. Please send the message text." });
      return;
    }

    const groups = state.groups || [];
    const intervalInfo = state.intervalInfo || parseIntervalText(state.intervalText || "1h");
    if (!groups.length || !intervalInfo) {
      await msg.respond({
        message: "❌ Something went wrong with the wizard. Please send /autosend to start again.",
      });
      state.done = true;
      return;
    }

    createAutoSendTimer(groups, intervalInfo, trimmedText);

    await msg.respond({
      message: `✓ Auto-send started to ${groups.length} groups every ${intervalInfo.label}.`,
    });
    state.done = true;
  }
};

async function startBot() {
  console.log("\n⏳ Connecting to Telegram...");

  // In headless environments (Railway), do not attempt interactive login
  if (isHeadless) {
    if (!sessionString) {
      console.error("❌ SESSION_STRING is missing in environment. Cannot run headless.");
      process.exit(1);
    }
    try {
      await client.connect();
      const me = await client.getMe();
      console.log("✓ Connected to Telegram (headless)!");
      console.log(`✓ Account: ${me.firstName}`);
      return;
    } catch (error) {
      console.error("✗ Headless connection error:", error.message);
      process.exit(1);
    }
  }

  try {
    await client.connect();
    
    try {
      const me = await client.getMe();
      console.log("✓ Connected to Telegram!");
      console.log(`✓ Account: ${me.firstName}`);
      saveSession();
      return;
    } catch (authError) {
      // Need to authenticate
      console.log("📱 Authentication required...");
    }
  } catch (error) {
    console.log("📱 Starting authentication...");
  }

  // Authenticate
  try {
    console.log(`📲 Phone number: ${phoneNumber}`);
    
    // Send auth code request
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phoneNumber,
        apiId: apiId,
        apiHash: apiHash,
        settings: new Api.CodeSettings(),
      })
    );

    console.log(`✓ Code sent! Phone code hash: ${result.phoneCodeHash}`);
    const code = await question("\n📲 Enter verification code: ");

    // Sign in
    const signIn = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phoneNumber,
        phoneCodeHash: result.phoneCodeHash,
        phoneCode: code,
      })
    );

    console.log("✓ Successfully signed in!");
    saveSession();
  } catch (error) {
    console.error("✗ Auth error:", error.message);
    throw error;
  }
}

async function sendMessageToGroup(groupName, message) {
  try {
    // Try to resolve entity (group/channel)
    const entity = await client.getEntity(groupName);
    await client.sendMessage(entity, { message });
    console.log(`✓ Message sent to ${groupName}`);
    return true;
  } catch (error) {
    console.log(`✗ Failed to send to ${groupName}: ${error.message}`);
    return false;
  }
}

async function autoMessageGroups() {
  console.log("\n📝 Enter groups to message (one per line, empty line to finish):");
  console.log("Examples: @channel_name, -1001234567890, 123456789");
  
  const groups = [];
  let input = "";
  
  while (true) {
    input = await question(`Group ${groups.length + 1}: `);
    if (!input.trim()) break;
    groups.push(input.trim());
  }

  if (groups.length === 0) {
    console.log("✗ No groups entered");
    return;
  }

  const message = await question("\n📨 Enter message to send: ");
  if (!message.trim()) {
    console.log("✗ No message entered");
    return;
  }

  console.log(`\n🤖 Sending to ${groups.length} groups...`);

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    console.log(`\n[${i + 1}/${groups.length}] Sending to: ${group}`);
    await sendMessageToGroup(group, message);

    if (i < groups.length - 1) {
      console.log(
        `⏳ Waiting ${config.messageDelay / 1000} seconds before next message...`
      );
      await sleep(config.messageDelay);
    }
  }

  console.log("\n✓ All messages sent!");
}

async function sendSingleMessage(groupName, message) {
  console.log(`\n📨 Sending message to ${groupName}...`);
  await sendMessageToGroup(groupName, message);
}

async function listGroups() {
  console.log("\n📋 Target Groups:");
  config.targetGroups.forEach((group, i) => {
    console.log(`  ${i + 1}. ${group}`);
  });
}

// Command handler for Telegram messages
async function setupMessageHandler() {
  console.log("\n🔔 Message handler activated - you can now control the bot via Telegram!");
  
  client.addEventHandler(async (event) => {
    try {
      if (event.message.out) return; // Ignore our own messages
      
      const msg = event.message;
      const text = msg.text || msg.message || "";
      
      const parts = text.split(" ");
      const command = parts[0].toLowerCase();
      
      console.log(`\n📨 Command received: ${text}`);
      
      // Get the sender's entity for reply
      const senderId = msg.senderId || msg.fromId;
      const senderKey = senderId?.toString?.() || String(senderId);

      // If user is in the middle of an /autosend wizard and this is not a command, treat as wizard input
      const existingAutosendState = autosendStates.get(senderKey);
      if (existingAutosendState && !text.startsWith("/")) {
        await processAutosendWizardInput(senderKey, existingAutosendState, text, msg);
        if (existingAutosendState.done) {
          autosendStates.delete(senderKey);
        }
        return;
      }

      if (!text.startsWith("/")) return; // Only listen to commands when not in a wizard
      
      // /send @group message text here
      if (command === "/send" && parts.length >= 3) {
        const group = parts[1];
        const customMsg = parts.slice(2).join(" ");
        await sendMessageToGroup(group, customMsg);
        
        try {
          await msg.respond({ message: `✓ Message sent to ${group}` });
        } catch (replyErr) {
          console.log(`✓ Message sent to ${group} (couldn't send reply)`);
        }
      }
      
      // /sendmulti group1 group2 group3|Message here
      else if (command === "/sendmulti") {
        const fullText = msg.text || msg.message || "";
        const [cmdPart, contentPart] = fullText.split("|");
        
        if (!contentPart) {
          try {
            await msg.respond({ message: "❌ Format: /sendmulti group1 group2|message" });
          } catch (e) {}
          return;
        }
        
        const groups = cmdPart.replace("/sendmulti", "").trim().split(" ").filter(g => g);
        const message = contentPart.trim();
        
        console.log(`\n🤖 Sending to ${groups.length} groups...`);
        
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i].trim();
          if (!group) continue;
          
          console.log(`[${i + 1}/${groups.length}] ${group}`);
          await sendMessageToGroup(group, message);
          if (i < groups.length - 1) await sleep(config.messageDelay);
        }
        
        try {
          await client.sendMessage(senderId, { message: `✓ Sent to ${groups.length} groups!` });
        } catch (replyErr) {
          console.log(`✓ Sent to ${groups.length} groups (couldn't send reply)`);
        }
      }

      // /autosend group1 group2|interval|Message here (interval supports s/m/h)
      else if (command === "/autosend") {
        const fullText = msg.text || msg.message || "";
        const partsPipe = fullText.split("|");

        // If user just sends "/autosend" (no pipes), start the step-by-step wizard
        if (partsPipe.length === 1) {
          const state = { step: "groups" };
          autosendStates.set(senderKey, state);
          await msg.respond({
            message:
              "Step 1: Send the list of group usernames/IDs separated by spaces.\n\nExample:\n@group1 @group2 -1001234567890",
          });
          return;
        }

        if (partsPipe.length < 3) {
          try {
            await msg.respond({ message: "❌ Format: /autosend group1 group2|interval|message (interval like 30s, 5m, 4h)" });
          } catch (e) {}
          return;
        }

        const cmdPart = partsPipe[0];
        const intervalPart = partsPipe[1];
        const messagePart = partsPipe.slice(2).join("|");

        const groups = cmdPart.replace("/autosend", "").trim().split(" ").filter(g => g);
        const intervalText = intervalPart.trim();

        const intervalInfo = parseIntervalText(intervalText);
        if (!intervalInfo || !groups.length || !messagePart.trim()) {
          try {
            await msg.respond({ message: "❌ Invalid format. Use: /autosend group1 group2|interval|message (interval like 30s, 5m, 4h)" });
          } catch (e) {}
          return;
        }

        const trimmedMessage = messagePart.trim();

        createAutoSendTimer(groups, intervalInfo, trimmedMessage);

        try {
          await msg.respond({ message: `✓ Auto-send started to ${groups.length} groups every ${intervalInfo.label}.` });
        } catch (e) {
          console.log("✓ Auto-send started (couldn't send confirmation message)");
        }
      }
      
      // /help
      else if (command === "/help") {
        const helpText = `🤖 **Bot Commands:**

/send @group message
Send message to one group

/sendmulti group1 group2 group3|Your message
Send to multiple groups

/autosend group1 group2|interval|Your message
Auto-send to multiple groups every X (supports s, m, h; e.g. 30s, 5m, 4h)

/help
Show this help

/stats
Show your account info

/stoptimers
Stop all auto-send timers`;
        try {
          await msg.respond({ message: helpText });
          console.log("✓ Help message sent");
        } catch (e) {
          console.log("✗ Help command executed - Error sending reply:", e.message);
        }
      }
      
      // /stats
      else if (command === "/stats") {
        try {
          const me = await client.getMe();
          const statsText = `📊 **Account Info:**
Name: ${me.firstName} ${me.lastName || ""}
ID: ${me.id}
Status: Online ✓`;
          await msg.respond({ message: statsText });
          console.log("✓ Stats message sent");
        } catch (e) {
          console.log("✗ Stats command executed - Error sending reply:", e.message);
        }
      }

      // /stoptimers
      else if (command === "/stoptimers") {
        try {
          activeTimers.forEach(clearInterval);
          activeTimers.length = 0;
          await msg.respond({ message: "✓ All auto-send timers stopped." });
          console.log("✓ All auto-send timers cleared");
        } catch (e) {
          console.log("✗ Error stopping timers:", e.message);
        }
      }
      
      else {
        try {
          await msg.respond({ message: "❓ Unknown command. Type /help" });
        } catch (e) {}
      }
      
    } catch (error) {
      console.error(`Error handling message: ${error.message}`);
    }
  }, new NewMessage({}));
}

async function showMenu() {
  console.log("\n" + "=".repeat(50));
  console.log("🤖 TELEGRAM AUTO-MESSAGING BOT");
  console.log("=".repeat(50));
  console.log("1. Send custom message to multiple groups");
  console.log("2. Send message to one group");
  console.log("3. Exit");
  console.log("=".repeat(50));
}

async function main() {
  try {
    await startBot();
    
    // Setup message handler for Telegram commands
    await setupMessageHandler();
    
    console.log("\n✓ Bot is ready! You can now send commands via Telegram:");
    console.log("  - Type /help in Telegram to see commands");
    console.log("  - Or use the terminal menu below (local mode)\n");

    // In headless environments (like Railway), skip interactive menu
    if (!isHeadless) {
      let running = true;
      while (running) {
        await showMenu();
        const choice = await question("\nChoose option (1-3): ");

        switch (choice.trim()) {
          case "1":
            await autoMessageGroups();
            break;

          case "2":
            const group = await question("Enter group ID/@username: ");
            const message = await question("Enter message to send: ");
            if (group.trim() && message.trim()) {
              await sendSingleMessage(group.trim(), message.trim());
            } else {
              console.log("✗ Invalid input");
            }
            break;

          case "3":
            console.log("\n👋 Disconnecting...");
            running = false;
            break;

          default:
            console.log("✗ Invalid choice!");
        }
      }

      await client.disconnect();
    } else {
      console.log("Running in headless mode (no terminal menu).");
    }
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}`);
  } finally {
    if (!isHeadless) {
      rl.close();
      process.exit(0);
    }
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n\n👋 Bot stopped by user");
  try {
    await client.disconnect();
  } catch (error) {
    // Ignore
  }
  rl.close();
  process.exit(0);
});

// Start the bot
main();
