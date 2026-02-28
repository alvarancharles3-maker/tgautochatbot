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

// Allowed user IDs for bot commands
const allowedUserIds = [7968867231, 1016048363];

// Detect non-interactive/headless environments (e.g. Railway)
const isHeadless = !!process.env.RAILWAY_ENVIRONMENT || process.env.HEADLESS === "1";

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
      console.log(`⏳ Waiting ${config.messageDelay / 1000} seconds before next message...`);
      await sleep(config.messageDelay);
    }
  }

  console.log("\n✓ All messages sent!");
}

async function sendSingleMessage(groupName, message) {
  console.log(`\n📨 Sending message to ${groupName}...`);
  await sendMessageToGroup(groupName, message);
}

// Command handler for Telegram messages
async function setupMessageHandler() {
  console.log("\n🔔 Message handler activated - you can now control the bot via Telegram!");
  
  client.addEventHandler(async (event) => {
    try {
      if (event.message.out) return; // Ignore our own messages
      
      const msg = event.message;
      const text = msg.text || msg.message || "";
      
      // Only process messages that start with /
      if (!text.startsWith("/")) return;
      
      const parts = text.split(" ");
      const command = parts[0].toLowerCase().replace(/^\//, "");
      if (!command) return;
      
      console.log(`\n📨 Command received: ${text}`);
      
      // Get the sender's entity for reply
      const senderId = msg.senderId || msg.fromId;
      const userIdNum = Number(senderId);
      
      // Check if user is authorized
      if (!allowedUserIds.includes(userIdNum)) {
        console.log(`⛔ Unauthorized command from user ${senderId}`);
        try {
          await client.sendMessage(senderId, { 
            message: "👋 **Hello! Want to plug a service?**\n\nIt is available right now!\n\n👉 Click here to send me a direct message: https://t.me/lithuazs" 
          });
        } catch (e) {
          console.log(`✗ Could not DM unauthorized user ${senderId}.`);
        }
        return;
      }
      
      // /send @group message text here
      if (command === "send" && parts.length >= 3) {
        const group = parts[1];
        const customMsg = parts.slice(2).join(" ");
        await sendMessageToGroup(group, customMsg);
        
        try {
          await msg.respond({ message: `✓ Message sent to ${group}` });
        } catch (replyErr) {
          try {
            await client.sendMessage(senderId, { message: `✓ Message sent to ${group}` });
          } catch (e2) {
            console.log(`✓ Message sent to ${group} (couldn't send reply)`);
          }
        }
      }
      
      // /sendmulti group1 group2 group3|Message here
      else if (command === "sendmulti") {
        const fullText = msg.text || msg.message || "";
        const [cmdPart, contentPart] = fullText.split("|");
        
        if (!contentPart) {
          try {
            await msg.respond({ message: "❌ Format: /sendmulti group1 group2|message" });
          } catch (e) {
            try {
              await client.sendMessage(senderId, { message: "❌ Format: /sendmulti group1 group2|message" });
            } catch (e2) {}
          }
          return;
        }
        
        const groups = cmdPart.replace(/^\/*\s*sendmulti\s+/, "").trim().split(/\s+/).filter(g => g);
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
          await msg.respond({ message: `✓ Sent to ${groups.length} groups!` });
        } catch (replyErr) {
          try {
            await client.sendMessage(senderId, { message: `✓ Sent to ${groups.length} groups!` });
          } catch (e2) {
            console.log(`✓ Sent to ${groups.length} groups (couldn't send reply)`);
          }
        }
      }

      // /autosend group1 group2|interval|Message here (interval supports s/m/h)
      else if (command === "autosend") {
        const fullText = msg.text || msg.message || "";
        const partsPipe = fullText.split("|");
        
        if (partsPipe.length < 3) {
          try {
            await msg.respond({ message: "❌ Format: /autosend group1 group2|interval|message (interval like 30s, 5m, 4h)" });
          } catch (e) {
            try {
              await client.sendMessage(senderId, { message: "❌ Format: /autosend group1 group2|interval|message (interval like 30s, 5m, 4h)" });
            } catch (e2) {}
          }
          return;
        }

        const cmdPart = partsPipe[0];
        const intervalPart = partsPipe[1];
        const messagePart = partsPipe.slice(2).join("|");

        const groups = cmdPart.replace(/^\/*\s*autosend\s+/, "").trim().split(/\s+/).filter(g => g);
        const intervalText = intervalPart.trim();

        const match = intervalText.match(/^(\d*\.?\d+)\s*([smhSMH]?)$/);
        if (!match) {
          try {
            await msg.respond({ message: "❌ Invalid interval. Use number + unit: 30s, 5m, 4h" });
          } catch (e) {
            try {
              await client.sendMessage(senderId, { message: "❌ Invalid interval. Use number + unit: 30s, 5m, 4h" });
            } catch (e2) {}
          }
          return;
        }
        
        const value = parseFloat(match[1]);
        const unit = (match[2] || "h").toLowerCase();

        let intervalMs;
        if (unit === "s") {
          intervalMs = value * 1000;
        } else if (unit === "m") {
          intervalMs = value * 60 * 1000;
        } else {
          intervalMs = value * 60 * 60 * 1000;
        }

        if (!groups.length || !value || value <= 0 || !messagePart.trim()) {
          try {
            await msg.respond({ message: "❌ Invalid format. Make sure you provided groups and a message." });
          } catch (e) {
            try {
              await client.sendMessage(senderId, { message: "❌ Invalid format. Make sure you provided groups and a message." });
            } catch (e2) {}
          }
          return;
        }

        const trimmedMessage = messagePart.trim();

        const timer = setInterval(async () => {
          console.log(`\n⏰ Auto-send tick: ${groups.length} groups every ${intervalText}`);
          for (let i = 0; i < groups.length; i++) {
            const group = groups[i].trim();
            if (!group) continue;
            
            console.log(`[auto ${i + 1}/${groups.length}] ${group}`);
            await sendMessageToGroup(group, trimmedMessage);
            if (i < groups.length - 1) await sleep(config.messageDelay);
          }
        }, intervalMs);

        activeTimers.push(timer);

        try {
          await msg.respond({ message: `✓ Auto-send started to ${groups.length} groups every ${intervalText}.` });
        } catch (e) {
          try {
            await client.sendMessage(senderId, { message: `✓ Auto-send started to ${groups.length} groups every ${intervalText}.` });
          } catch (e2) {
            console.log("✓ Auto-send started (couldn't send confirmation message)");
          }
        }
      }
      
      // /help (Replaced inline buttons with clickable text commands to prevent crashing)
      else if (command === "help") {
        const helpText = `🤖 **Bot Commands Menu:**\n
Click a command below to copy it to your chat bar:\n
📤 \`/send\` - Send to one group
📤 \`/sendmulti\` - Send to multiple groups
⏰ \`/autosend\` - Start interval sending
📋 \`/has\` - List all your groups
📊 \`/stats\` - View account status
⛔ \`/stoptimers\` - Stop all auto-sends\n
ℹ️ Use \`|\` to separate parts for multi/autosend.
✉️ [Contact Admin](https://t.me/lithuazs)`;

        try {
          await msg.respond({ message: helpText, parseMode: "markdown" });
          console.log("✓ Help message sent");
        } catch (e) {
          try {
            await client.sendMessage(senderId, { message: helpText, parseMode: "markdown" });
            console.log("✓ Help message sent (via DM)");
          } catch (e2) {
            console.log("✗ Help command executed - Error sending reply:", e2.message);
          }
        }
      }
      
      // /stats
      else if (command === "stats") {
        try {
          const me = await client.getMe();
          const statsText = `📊 **Account Info:**
Name: ${me.firstName} ${me.lastName || ""}
ID: \`${me.id}\`
Active Timers: ${activeTimers.length}
Status: Online ✓`;
          try {
            await msg.respond({ message: statsText, parseMode: "markdown" });
          } catch (e) {
            await client.sendMessage(senderId, { message: statsText, parseMode: "markdown" });
          }
          console.log("✓ Stats message sent");
        } catch (e) {
          console.log("✗ Stats command executed - Error sending reply:", e.message);
        }
      }

      // /stoptimers
      else if (command === "stoptimers") {
        try {
          activeTimers.forEach(clearInterval);
          activeTimers.length = 0;
          try {
            await msg.respond({ message: "✓ All auto-send timers stopped." });
          } catch (e) {
            await client.sendMessage(senderId, { message: "✓ All auto-send timers stopped." });
          }
          console.log("✓ All auto-send timers cleared");
        } catch (e) {
          console.log("✗ Error stopping timers:", e.message);
        }
      }

      // /has - List all groups/channels the account has joined
      else if (command === "has") {
        try {
          console.log("\n📋 Fetching all groups and channels...");
          try {
            await msg.respond({ message: "⏳ Fetching groups..." });
          } catch (e) {
            await client.sendMessage(senderId, { message: "⏳ Fetching groups..." });
          }

          const dialogs = await client.getDialogs({ limit: 100 });
          const groups = [];

          for (const dialog of dialogs) {
            const entity = dialog.entity;
            if (entity.className === "Chat" || entity.className === "Channel") {
              const title = entity.title || entity.username || `Unknown (${entity.id})`;
              const username = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
              groups.push({ title, username, id: entity.id });
            }
          }

          if (groups.length === 0) {
            try {
              await msg.respond({ message: "📭 No groups or channels found." });
            } catch (e) {
              try {
                await client.sendMessage(senderId, { message: "📭 No groups or channels found." });
              } catch (e2) {}
            }
            return;
          }

          let groupsList = `📋 **Your Groups & Channels** (${groups.length}):\n\n`;
          groups.forEach((group, idx) => {
            groupsList += `${idx + 1}. ${group.title}\n   ${group.username}\n`;
          });

          // Send in chunks if too long
          if (groupsList.length > 4096) {
            const chunks = [];
            let currentChunk = `📋 **Your Groups & Channels** (${groups.length}):\n\n`;

            groups.forEach((group, idx) => {
              const line = `${idx + 1}. ${group.title}\n   ${group.username}\n`;
              if ((currentChunk + line).length > 4000) {
                chunks.push(currentChunk);
                currentChunk = line;
              } else {
                currentChunk += line;
              }
            });
            if (currentChunk) chunks.push(currentChunk);

            for (const chunk of chunks) {
              try {
                await msg.respond({ message: chunk });
              } catch (e) {
                try {
                  await client.sendMessage(senderId, { message: chunk });
                } catch (e2) {}
              }
            }
          } else {
            try {
              await msg.respond({ message: groupsList });
            } catch (e) {
              try {
                await client.sendMessage(senderId, { message: groupsList });
              } catch (e2) {
                console.log("✗ Error sending group list");
              }
            }
          }
          console.log(`✓ Found ${groups.length} groups/channels`);
        } catch (e) {
          console.log("✗ Error fetching groups:", e.message);
          try {
            await msg.respond({ message: `❌ Error: ${e.message}` });
          } catch (replyErr) {
            try {
              await client.sendMessage(senderId, { message: `❌ Error: ${e.message}` });
            } catch (e2) {}
          }
        }
      }
      
      // Unknown command
      else {
        try {
          await msg.respond({ message: "❓ Unknown command. Type /help to see the menu." });
        } catch (e) {
          try {
            await client.sendMessage(senderId, { message: "❓ Unknown command. Type /help to see the menu." });
          } catch (e2) {}
        }
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