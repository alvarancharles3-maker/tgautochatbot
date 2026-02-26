/**
 * Configuration for Telegram Auto Chat Bot
 */

export const config = {
  // List of group/channel IDs or @usernames to send messages to
  // Use chat IDs like: -1001234567890 (get from chat link: t.me/c/1234567890)
  // Or use @username for public channels
  targetGroups: [
    // Add your groups in one of these formats:
    // "@group_username",
    // -1001234567890,  // private group ID
    // "123456789",  // channel ID
  ],

  // Auto-response messages
  autoMessages: [
    "Hey! I'm interested in this group",
    "Thanks for the invite!",
    "Looking forward to being part of this community",
  ],

  // Delay between messages (in milliseconds)
  messageDelay: 5000, // 5 seconds

  // Enable/disable auto-messaging
  autoMessageEnabled: true,

  // Session directory
  sessionDir: "./session",
};
