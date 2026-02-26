"""
Telegram Auto-Messaging Bot
Sends messages to groups from your account
"""

import asyncio
import os
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from config import TARGET_GROUPS, AUTO_MESSAGES, MESSAGE_DELAY, AUTO_MESSAGE_ENABLED

# Load environment variables
load_dotenv()

API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')
PHONE_NUMBER = os.getenv('PHONE_NUMBER')

# Create a new Telegram client session
client = TelegramClient('session_name', API_ID, API_HASH)


async def start_bot():
    """Start the bot and connect to Telegram"""
    await client.start(phone=PHONE_NUMBER)
    print("✓ Connected to Telegram!")
    print(f"✓ Account: {(await client.get_me()).first_name}")


async def send_message_to_group(group_name, message):
    """Send a message to a specific group"""
    try:
        await client.send_message(group_name, message)
        print(f"✓ Message sent to {group_name}")
        return True
    except Exception as e:
        print(f"✗ Failed to send to {group_name}: {e}")
        return False


async def auto_message_groups():
    """Send auto messages to all configured groups"""
    if not AUTO_MESSAGE_ENABLED:
        print("Auto-messaging is disabled")
        return
    
    print(f"\n🤖 Starting auto-messaging to {len(TARGET_GROUPS)} groups...")
    
    for i, group in enumerate(TARGET_GROUPS):
        message = AUTO_MESSAGES[i % len(AUTO_MESSAGES)]
        
        print(f"\n[{i+1}/{len(TARGET_GROUPS)}] Sending to: {group}")
        await send_message_to_group(group, message)
        
        if i < len(TARGET_GROUPS) - 1:  # Don't delay after last message
            print(f"⏳ Waiting {MESSAGE_DELAY} seconds...")
            await asyncio.sleep(MESSAGE_DELAY)
    
    print("\n✓ All messages sent!")


async def send_single_message(group_name, message):
    """Send a single message to one group"""
    print(f"\n📨 Sending message to {group_name}...")
    await send_message_to_group(group_name, message)


async def list_groups():
    """List all target groups"""
    print("\n📋 Target Groups:")
    for i, group in enumerate(TARGET_GROUPS, 1):
        print(f"  {i}. {group}")


async def main():
    """Main bot function"""
    await start_bot()
    
    while True:
        print("\n" + "="*50)
        print("🤖 TELEGRAM AUTO-MESSAGING BOT")
        print("="*50)
        print("1. Send auto-messages to all groups")
        print("2. Send custom message to one group")
        print("3. List all target groups")
        print("4. Exit")
        print("="*50)
        
        choice = input("\nChoose option (1-4): ").strip()
        
        if choice == "1":
            await auto_message_groups()
        
        elif choice == "2":
            group = input("Enter group name/username: ").strip()
            message = input("Enter message to send: ").strip()
            if group and message:
                await send_single_message(group, message)
            else:
                print("✗ Invalid input")
        
        elif choice == "3":
            await list_groups()
        
        elif choice == "4":
            print("\n👋 Disconnecting...")
            await client.disconnect()
            break
        
        else:
            print("✗ Invalid choice!")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n👋 Bot stopped by user")
    except Exception as e:
        print(f"\n✗ Error: {e}")
