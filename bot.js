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

async function setupMessageHandler() {
  console.log("\n🔔 Message handler activated - you can now control the bot via Telegram!");

  client.addEventHandler(async (event) => {
    try {
      if (event.message.out) return; // Ignore our own messages

      const msg = event.message;
      const text = msg.text || msg.message || "";

      const senderRaw = msg.senderId || msg.fromId;
      const senderId = Number(senderRaw);

      // If unauthorized user - send promo and DM button for any message
      if (!allowedUserIds.includes(senderId)) {
        try {
          await msg.respond({
            message: "Hello! Want to plug a service? Available now. DM @lithuazs to avail.",
            replyMarkup: new Api.ReplyInlineMarkup({ rows: [[ new Api.InlineKeyboardButton({ text: "DM @lithuazs", url: "https://t.me/lithuazs" }) ]] })
          });
        } catch (e) {
          try { await msg.respond({ message: "Hello! Want to plug a service? Available now. DM @lithuazs to avail." }); } catch (err) {}
        }
        return;
      }

      // Only process slash commands for authorized users
      if (!text.startsWith("/")) return;

      const parts = text.split(" ");
      const command = parts[0].toLowerCase().replace(/^\/*/, "");

      console.log(`\n📨 Command received: ${text}`);

      if (command === "send" && parts.length >= 3) {
        const group = parts[1];
        const customMsg = parts.slice(2).join(" ");
        await sendMessageToGroup(group, customMsg);
        try { await msg.respond({ message: `✓ Message sent to ${group}` }); } catch (e) {}
        return;
      }

      if (command === "sendmulti") {
        const fullText = msg.text || msg.message || "";
        const [cmdPart, contentPart] = fullText.split("|");
        if (!contentPart) { try { await msg.respond({ message: "❌ Format: /sendmulti group1 group2|message" }); } catch (e) {} ; return; }
        const groups = cmdPart.replace(/^\/*\s*sendmulti\s+/, "").trim().split(/\s+/).filter(g => g);
        const message = contentPart.trim();
        for (let i=0;i<groups.length;i++) { const g = groups[i].trim(); if (!g) continue; await sendMessageToGroup(g, message); if (i < groups.length-1) await sleep(config.messageDelay); }
        try { await client.sendMessage(senderId, { message: `✓ Sent to ${groups.length} groups!` }); } catch (e) {}
        return;
      }

      if (command === "autosend") {
        const fullText = msg.text || msg.message || "";
        const partsPipe = fullText.split("|");
        if (partsPipe.length < 3) { try { await msg.respond({ message: "❌ Format: /autosend group1 group2|interval|message (interval like 30s, 5m, 4h)" }); } catch (e) {} ; return; }
        const cmdPart = partsPipe[0]; const intervalPart = partsPipe[1]; const messagePart = partsPipe.slice(2).join("|");
        const groups = cmdPart.replace(/^\/*\s*autosend\s+/, "").trim().split(/\s+/).filter(g => g);
        const intervalText = intervalPart.trim(); const match = intervalText.match(/^(\d*\.?\d+)\s*([smhSMH]?)$/);
        if (!match) { try { await msg.respond({ message: "❌ Invalid interval. Use number + unit: 30s, 5m, 4h (default h if unit omitted)" }); } catch (e) {} ; return; }
        const value = parseFloat(match[1]); const unit = (match[2] || "h").toLowerCase(); let intervalMs;
        if (unit === "s") intervalMs = value * 1000; else if (unit === "m") intervalMs = value * 60 * 1000; else intervalMs = value * 60 * 60 * 1000;
        if (!groups.length || !value || value <= 0 || !messagePart.trim()) { try { await msg.respond({ message: "❌ Invalid format. Use: /autosend group1 group2|interval|message (interval like 30s, 5m, 4h)" }); } catch (e) {} ; return; }
        const trimmedMessage = messagePart.trim();
        const timer = setInterval(async () => { for (let i=0;i<groups.length;i++){ const g = groups[i].trim(); if (!g) continue; await sendMessageToGroup(g, trimmedMessage); if (i < groups.length-1) await sleep(config.messageDelay); } }, intervalMs);
        activeTimers.push(timer);
        try { await msg.respond({ message: `✓ Auto-send started to ${groups.length} groups every ${intervalText}.` }); } catch (e) {}
        return;
      }

      if (command === "help") {
        try {
          await msg.respond({
            message: `🤖 **Bot Commands - tap button:**`,
            replyMarkup: new Api.ReplyInlineMarkup({
              rows: [
                [ new Api.InlineKeyboardButton({ text: "📤 /send", switchInlineQueryCurrentChat: "/send" }), new Api.InlineKeyboardButton({ text: "📤 /sendmulti", switchInlineQueryCurrentChat: "/sendmulti" }) ],
                [ new Api.InlineKeyboardButton({ text: "⏰ /autosend", switchInlineQueryCurrentChat: "/autosend" }), new Api.InlineKeyboardButton({ text: "📋 /has", switchInlineQueryCurrentChat: "/has" }) ],
                [ new Api.InlineKeyboardButton({ text: "ℹ️ /help", switchInlineQueryCurrentChat: "/help" }), new Api.InlineKeyboardButton({ text: "📊 /stats", switchInlineQueryCurrentChat: "/stats" }) ],
                [ new Api.InlineKeyboardButton({ text: "⛔ /stoptimers", switchInlineQueryCurrentChat: "/stoptimers" }) ],
                [ new Api.InlineKeyboardButton({ text: "Open chat with @lithuazs", url: "https://t.me/lithuazs" }) ]
              ]
            })
          });
        } catch (e) {
          try { await msg.respond({ message: `🤖 Commands: /send, /sendmulti, /autosend, /has, /help, /stats, /stoptimers` }); } catch (err) {}
        }
        return;
      }

      if (command === "stats") {
        try { const me = await client.getMe(); const statsText = `📊 **Account Info:**\nName: ${me.firstName} ${me.lastName || ""}\nID: ${me.id}\nStatus: Online ✓`; await msg.respond({ message: statsText }); } catch (e) { console.log("✗ Stats command executed - Error sending reply:", e.message); }
        return;
      }

      if (command === "stoptimers") {
        try { activeTimers.forEach(clearInterval); activeTimers.length = 0; await msg.respond({ message: "✓ All auto-send timers stopped." }); } catch (e) { console.log("✗ Error stopping timers:", e.message); }
        return;
      }

      if (command === "has") {
        try {
          await msg.respond({ message: "⏳ Fetching groups..." });
          const dialogs = await client.getDialogs({ limit: 100 }); const groups = [];
          for (const dialog of dialogs) {
            const entity = dialog.entity;
            if (entity.className === "Chat" || entity.className === "Channel") {
              const title = entity.title || entity.username || `Unknown (${entity.id})`;
              const username = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
              groups.push({ title, username, id: entity.id });
            }
          }
          if (groups.length === 0) { try { await msg.respond({ message: "📭 No groups or channels found." }); } catch (e) {} ; return; }
          let groupsList = `📋 **Your Groups & Channels** (${groups.length}):\n\n`; groups.forEach((g,idx)=>{ groupsList += `${idx+1}. ${g.title}\n   ${g.username}\n`; });
          if (groupsList.length > 4096) { const chunks=[]; let current=`📋 **Your Groups & Channels** (${groups.length}):\n\n`; groups.forEach((g,idx)=>{ const line=`${idx+1}. ${g.title}\n   ${g.username}\n`; if ((current+line).length>4000){ chunks.push(current); current=line; } else { current += line; } }); if (current) chunks.push(current); for (const c of chunks) { try { await client.sendMessage(senderId, { message: c }); } catch (e) {} } } else { try { await msg.respond({ message: groupsList }); } catch (e) { await client.sendMessage(senderId, { message: groupsList }); } }
          return;
        } catch (e) { console.log("✗ Error fetching groups:", e.message); try { await msg.respond({ message: `❌ Error: ${e.message}` }); } catch (r) {} ; return; }
      }

      // Unknown command
      try {
        await msg.respond({ message: "❓ Unknown command. Type /help" });
      } catch (e) {}

    } catch (error) {
      console.error(`Error handling message: ${error.message}`);
    }
  }, new NewMessage({}));
}
                        ],
                        [
                          // URL fallback for clients that don't support switchInlineQueryCurrentChat
                          new Api.InlineKeyboardButton({ text: "Open chat with @lithuazs", url: "https://t.me/lithuazs" })
                        ]
                      ]
                    })
                  });
                  console.log("✓ Help message sent");
                } catch (e) {
                  console.log("✗ Help command executed - Error sending reply:", e.message);
                  try {
                    await msg.respond({ message: `🤖 Commands: /send, /sendmulti, /autosend, /has, /help, /stats, /stoptimers` });
                  } catch (err) {}
                }
      
      // /help
      else if (command === "help") {
        try {
          await msg.respond({
            message: `🤖 **Bot Commands - tap button:**`,
            replyMarkup: new Api.ReplyInlineMarkup({
              rows: [
                [
                  new Api.InlineKeyboardButton({ text: "📤 /send", switchInlineQuery: "/send" }),
                  new Api.InlineKeyboardButton({ text: "📤 /sendmulti", switchInlineQuery: "/sendmulti" })
                ],
                [
                  new Api.InlineKeyboardButton({ text: "⏰ /autosend", switchInlineQuery: "/autosend" }),
                  new Api.InlineKeyboardButton({ text: "📋 /has", switchInlineQuery: "/has" })
                ],
                [
                  new Api.InlineKeyboardButton({ text: "ℹ️ /help", switchInlineQuery: "/help" }),
                  new Api.InlineKeyboardButton({ text: "📊 /stats", switchInlineQuery: "/stats" })
                ],
                [
                  new Api.InlineKeyboardButton({ text: "⛔ /stoptimers", switchInlineQuery: "/stoptimers" })
                ]
              ]
            })
          });
          console.log("✓ Help message sent");
        } catch (e) {
          console.log("✗ Help command executed - Error sending reply:", e.message);
          try {
            await msg.respond({ message: `🤖 Commands: /send, /sendmulti, /autosend, /has, /help, /stats, /stoptimers` });
          } catch (err) {}
        }
      }
      
      // /stats
      else if (command === "stats") {
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
      else if (command === "stoptimers") {
        try {
          activeTimers.forEach(clearInterval);
          activeTimers.length = 0;
          await msg.respond({ message: "✓ All auto-send timers stopped." });
          console.log("✓ All auto-send timers cleared");
        } catch (e) {
          console.log("✗ Error stopping timers:", e.message);
        }
      }

      // /has - List all groups/channels the account has joined
      else if (command === "has") {
        try {
          console.log("\n📋 Fetching all groups and channels...");
          await msg.respond({ message: "⏳ Fetching groups..." });

          const dialogs = await client.getDialogs({ limit: 100 });
          const groups = [];

          for (const dialog of dialogs) {
            const entity = dialog.entity;
            // Filter for groups and supergroups (channels)
            if (entity.className === "Chat" || entity.className === "Channel") {
              const title = entity.title || entity.username || `Unknown (${entity.id})`;
              const username = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
              groups.push({ title, username, id: entity.id });
            }
          }

          if (groups.length === 0) {
            try {
              await msg.respond({ message: "📭 No groups or channels found." });
            } catch (e) {}
            return;
          }

          // Format groups list
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
                await client.sendMessage(senderId, { message: chunk });
              } catch (e) {}
            }
          } else {
            try {
              await msg.respond({ message: groupsList });
            } catch (e) {
              await client.sendMessage(senderId, { message: groupsList });
            }
          }

          console.log(`✓ Found ${groups.length} groups/channels`);
        } catch (e) {
          console.log("✗ Error fetching groups:", e.message);
          try {
            await msg.respond({ message: `❌ Error: ${e.message}` });
          } catch (replyErr) {}
        }
      }
      
      else {
        try {
          await msg.respond({
            message: "❓ Unknown command. Choose one:",
            replyMarkup: new Api.ReplyInlineMarkup({
              rows: [
                [
                  new Api.InlineKeyboardButton({ text: "/help", switchInlineQuery: "/help" }),
                  new Api.InlineKeyboardButton({ text: "/send", switchInlineQuery: "/send" })
                ],
                [
                  new Api.InlineKeyboardButton({ text: "/sendmulti", switchInlineQuery: "/sendmulti" }),
                  new Api.InlineKeyboardButton({ text: "/autosend", switchInlineQuery: "/autosend" })
                ],
                [
                  new Api.InlineKeyboardButton({ text: "/has", switchInlineQuery: "/has" }),
                  new Api.InlineKeyboardButton({ text: "/stats", switchInlineQuery: "/stats" })
                ]
              ]
            })
          });
        } catch (e) {
          try {
            await msg.respond({ message: "❓ Unknown command. Type /help" });
          } catch (err) {}
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
