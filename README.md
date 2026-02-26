# tgautochatbot

Telegram auto-messaging bot that uses your account to send automated messages to groups.

## Setup

1. Install Node.js (v16 or higher) from [nodejs.org](https://nodejs.org)
2. Create a `.env` file with:
   ```bash
   API_ID=YOUR_API_ID
   API_HASH=YOUR_API_HASH
   PHONE_NUMBER=+1234567890
   ```
3. Configure your target groups in `config.js`
4. Install dependencies:
   ```bash
   npm install
   ```
5. Run the bot:
   ```bash
   npm start
   ```

Keep your `.env` file secret and never commit it.
