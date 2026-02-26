# Telegram Auto-Messaging Bot (Node.js)

A Node.js bot that uses your Telegram account to send automated messages to groups.

## Setup

### 1. Install Node.js
Download and install from [nodejs.org](https://nodejs.org) (v16 or higher)

### 2. Update `.env` file
Edit the `.env` file with your credentials:
```
API_ID=39687802
API_HASH=7d45a4932943176e5ce0107ceef1e6ee
PHONE_NUMBER=+1234567890
```

**Replace `+1234567890` with your actual phone number (with country code)**

### 3. Configure target groups
Edit `config.js` and add your target groups:
```javascript
targetGroups: [
    "group_username_1",
    "group_username_2",
    "@public_group",
]
```

### 4. Install dependencies
```bash
npm install
```

### 5. Run the bot
```bash
npm start
```

## First Run
On **first run**, Telegram will send a verification code to your phone. The bot will ask for it in the terminal.

After verification, the session is saved and you won't need to verify again.

## Usage

The bot provides an interactive menu:
1. **Send auto-messages** - Sends configured messages to all groups
2. **Send custom message** - Send one message to a specific group
3. **List groups** - View all configured target groups
4. **Exit** - Disconnect and quit

## Configuration

Edit `config.js` to customize:

- **targetGroups** - List of groups/channels to message
- **autoMessages** - Messages to send (rotates through them)
- **messageDelay** - Wait time between messages (milliseconds)
- **autoMessageEnabled** - Enable/disable auto-messaging

## ⚠️ Important Notes

- **Be careful not to spam** - Telegram may limit or ban your account
- **Respect group rules** - Only send messages where appropriate
- **Session file** - Saved in `./session/session.txt` after first login
- **Keep `.env` secret** - Don't share your API credentials

## Files

- `bot.js` - Main bot script
- `config.js` - Configuration
- `.env` - Environment variables
- `package.json` - Dependencies
- `session/` - Session storage (created automatically)

## Troubleshooting

- **"API_ID is not a number"** - Check `.env` file format
- **"Invalid phone number"** - Use format: +1234567890
- **"Access denied"** - Some groups may block your messages
- **"Failed to get entity"** - Make sure group username is correct
- **"Connection timeout"** - Check your internet connection
