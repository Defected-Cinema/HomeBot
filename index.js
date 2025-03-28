const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();
const Imap = require('node-imap');
const { simpleParser } = require('mailparser');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const remindersFile = "reminders.json";
let reminders = [];



// Load reminders from file on startup
function loadReminders() {
    if (fs.existsSync(remindersFile)) {
        const data = fs.readFileSync(remindersFile);
        reminders = JSON.parse(data);
        console.log("Reminders loaded:", reminders);

        // Re-schedule reminders
        reminders.forEach(r => scheduleReminder(r));
    }
}

async function logErrorToDiscord(error) {
    console.error("⚠️ Error encountered:", error);

    try {
        const logChannel = await client.channels.fetch("1352011403200041135");
        await logChannel.send(`⚠️ **Error Encountered:**\n\`\`\`${error.stack || error}\`\`\``);
    } catch (err) {
        console.error("⚠️ Failed to log error to Discord:", err);
    }
}

// Function to post the weekly chore list automatically
async function postWeeklyChoreList() {
    const channelId = "1351264750960382014";
    const channel = await client.channels.fetch(channelId);

    if (!channel) {
        console.error("⚠️ Chore board channel not found.");
        return;
    }

    // Clear previous messages in the channel
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        await channel.bulkDelete(messages, true);
    } catch (error) {
        console.error("⚠️ Failed to clear messages before posting new chore list:", error);
    }

    if (reminders.length === 0) {
        await channel.send({ embeds: [{ color: 0xFFFF00, title: "📋 No Active Chores", description: "There are currently no chores assigned." }] });
        return;
    }

    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const choresByUser = {};

    for (const chore of reminders) {
        const userId = chore.user ? chore.user.toString() : "Unassigned";
        if (!choresByUser[userId]) {
            choresByUser[userId] = {};
            daysOfWeek.forEach(day => (choresByUser[userId][day] = []));
        }
        const cronParts = chore.cronSchedule.split(" ");
        if (cronParts.length === 5 && cronParts[2] === "*") {
            const dayIndex = parseInt(cronParts[4]);
            if (!isNaN(dayIndex) && dayIndex >= 0 && dayIndex <= 6) {
                const day = daysOfWeek[dayIndex];
                choresByUser[userId][day].push(chore.message);
            }
        }
    }

    const userMappings = {
        "240357041267277825": "Captain Ducky",
        "296462814195744769": "Botl",
        "172979233260437505": "Kirkland"
    };

    let choreEmbed = {
        color: 0x3498DB,
        title: "📌 Weekly Chore Schedule",
        description: "Here are the assigned chores for the week:",
        fields: []
    };

    Object.keys(choresByUser).forEach(userId => {
        const username = userMappings[userId] || "Unknown User";
        let choreDetails = "";

        daysOfWeek.forEach(day => {
            const chores = choresByUser[userId][day] || [];
            if (chores.length) {
                choreDetails += `**${day}:** ${chores.map(chore => `**${chore}**`).join(", ")}\n`;
            }
        });

        choreEmbed.fields.push({
            name: `🧹 ${username}`,
            value: choreDetails || "No chores assigned",
            inline: true
        });
    });

    if (choreEmbed.fields.length === 0) {
        choreEmbed.description = "No active chores scheduled.";
    }

    await channel.send({ embeds: [choreEmbed] });
}

// Schedule the chore list to be posted every Monday at 9 AM
cron.schedule("0 9 * * 1", () => {
    postWeeklyChoreList();
});

// Save reminders to file
function saveReminders() {
    fs.writeFileSync(remindersFile, JSON.stringify(reminders, null, 2));
}

// Schedule a reminder using cron
function scheduleReminder(reminder) {
    if (!reminder.cronSchedule || typeof reminder.cronSchedule !== "string") {
        console.error(`Invalid cron schedule for reminder:`, reminder.cronSchedule);
        return; // Prevents the bot from crashing
    }

    cron.schedule(reminder.cronSchedule, async () => {
        if (reminder.user) {
            try {
                const user = await client.users.fetch(reminder.user);
                const embed = {
                    color: 0xFFCC00,
                    title: "🔔 Daily Chore Reminder!",
                    description: `You have the following task(s) assigned today:\n\n**${reminder.message}**`,
                    timestamp: new Date()
                };
                await user.send({ embeds: [embed] });
            } catch (error) {
                console.error(`Failed to send DM to user ${reminder.user}:`, error);
            }
        }
    });
}

// Function to format schedule into human-readable form
function formatSchedule(cronSchedule) {
    if (cronSchedule.includes("Custom")) {
        return cronSchedule;
    } else if (cronSchedule.startsWith("0 9 * *")) {
        const dayNumber = cronSchedule.split(" ")[4];
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return `Every ${days[dayNumber]}`;
    } else if (/0 9 \d+ \* \*/.test(cronSchedule)) {
        return `Every month on the ${cronSchedule.split(" ")[2]}th`;
    } else {
        return "Custom Schedule";
    }
}

function startZohoMonitor() {
    const imapConfig = {
        user: process.env.ZOHO_EMAIL,
        password: process.env.ZOHO_PASSWORD,
        host: 'imap.zoho.com',
        port: 993,
        tls: true,
    };

    const imap = new Imap(imapConfig);

    function openInbox(cb) {
        imap.openBox('INBOX', false, cb);
    }

    imap.once('ready', () => {
        openInbox((err, box) => {
            if (err) throw err;
            console.log('Connected to Zoho inbox.');

            imap.on('mail', () => {
                imap.search(['UNSEEN'], (err, results) => {
                    if (err) throw err;
                    if (results.length === 0) return;

                    const f = imap.fetch(results, { bodies: '' });
                    f.on('message', msg => {
                        msg.on('body', stream => {
                            simpleParser(stream, async (err, parsed) => {
                                if (err) {
                                    logErrorToDiscord(error);
                                    return;
                                }

                                const { text } = parsed;
                                const chatGptResponse = await analyzeEmailWithChatGPT(text);
                                if (!chatGptResponse) {
                                    console.error("ChatGPT analysis failed.");
                                    logErrorToDiscord(error);
                                    return;
                                }

                                const { company, dueDate, amountDue, paymentLink } = chatGptResponse;

                                const embed = {
                                    color: 0x00FF00,
                                    title: "📩 New Bill Received",
                                    fields: [
                                        { name: "Company", value: company, inline: true },
                                        { name: "Due Date", value: dueDate, inline: true },
                                        { name: "Amount Due", value: `${amountDue.startsWith("$") ? amountDue : `$${amountDue}`}`, inline: true },
                                        { name: "Payment Link", value: paymentLink === "Not Found" ? paymentLink : `[Click Here](${paymentLink})` }
                                    ],
                                    timestamp: new Date(),
                                };

                                try {
                                    const channel = await client.channels.fetch("1351322801734160504");
                                    channel.send({ content: "<@&1351259091745505361>", embeds: [embed] });
                                } catch (error) {
                                    console.error("Error sending message to Discord:", error);
                                    logErrorToDiscord(error);
                                }
                            });
                        });

                        msg.once('attributes', attrs => {
                            const { uid } = attrs;
                            imap.addFlags(uid, '\\Seen', err => {
                                if (err) console.error("Error marking email as seen:", err);
                                logErrorToDiscord(console.error);
                            });
                        });
                    });

                    f.once('error', err => {
                        console.error('Fetch error:', err);
                        logErrorToDiscord(error);
                    });
                });
            });
        });
    });

    imap.once('error', err => {
        console.error('IMAP error:', err);
        logErrorToDiscord(error);
    });

    imap.once('end', () => {
        console.log('IMAP connection ended.');
        logErrorToDiscord(log);
    });

    imap.connect();
}

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'addchore') {
        const message = options.getString('message');
        let schedule = options.getString('schedule') || options.getString('day');
        let repeat = options.getString('repeat');
        if (!schedule || !repeat) {
            await interaction.reply("⚠️ You must provide a schedule and a repeat frequency for the reminder.");
            return;
        }
        schedule = schedule.toLowerCase();
        repeat = repeat.toLowerCase();

        const dayMappings = {
            "sunday": "0",
            "monday": "1",
            "tuesday": "2",
            "wednesday": "3",
            "thursday": "4",
            "friday": "5",
            "saturday": "6"
        };

        if (dayMappings[schedule]) {
            const dayNumber = dayMappings[schedule];

            if (repeat === "weekly") {
                schedule = `0 9 * * ${dayNumber}`; // Every week on the specified day at 9 AM
            } else if (repeat === "bi-weekly") {
                cron.schedule(`0 9 * * ${dayNumber}`, () => {
                    const currentWeek = Math.floor(new Date().getDate() / 7) % 2; // Odd/even week logic
                    if (currentWeek === 0) {
                        sendReminder(chore);
                    }
                });
                schedule = "Custom Bi-Weekly Schedule"; // Store as a placeholder
            } else if (repeat === "monthly") {
                cron.schedule(`0 9 * * ${dayNumber}`, () => {
                    const now = new Date();
                    if (now.getDate() <= 7) {
                        sendReminder(chore);
                    }
                });
                schedule = "Custom Monthly Schedule"; // Store as a placeholder
            }
        }

        if (!/^(\d+|\*) (\d+|\*) (\d+|\*) (\d+|\*) (\d+|\*)$/.test(schedule) && !schedule.startsWith("Custom")) {
            await interaction.reply("⚠️ Invalid schedule format! Please use a valid cron pattern or specify a valid day.");
            return;
        }

        const assignedUser = options.getUser('user');

        const chore = {
            id: Date.now(),
            message,
            cronSchedule: schedule,
            channelId: interaction.channelId,
            user: assignedUser ? assignedUser.id : null
        };

        reminders.push(chore);
        saveReminders();
        scheduleReminder(chore);

        const embed = {
            color: 0x00FF00,
            title: "✅ Chore Set!",
            description: `**Message:** ${message}\n**Schedule:** ${formatSchedule(schedule)}`,
            timestamp: new Date()
        };
        await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'deletechore') {
        const message = options.getString('message');

        const filteredChores = reminders.filter(r => r.message.toLowerCase().includes(message.toLowerCase()));
        if (filteredChores.length === 0) {
            await interaction.reply({ embeds: [{ color: 0xFF0000, title: "⚠️ Chore Not Found", description: `No chore found containing **"${message}"**.` }] });
            return;
        }

        if (filteredChores.length === 1) {
            const selectedChore = filteredChores[0];
            reminders = reminders.filter(r => r.id !== selectedChore.id);
            saveReminders();
 
            const confirmationEmbed = {
                color: 0xFF0000,
                title: "🗑️ Chore Deleted",
                description: `Chore containing **"${selectedChore.message}"** has been removed.`,
                timestamp: new Date()
            };
 
            await interaction.reply({ embeds: [confirmationEmbed] });
            return;
        }

        const reminderList = filteredChores.map((r, index) => `**${index + 1}.** ${r.message}`).join('\n');
        
        const reminderButtons = filteredChores.map((_, index) => {
            return new ButtonBuilder()
                .setCustomId(`delete_${filteredChores[index].id}`)
                .setLabel(`${index + 1}`)
                .setStyle(ButtonStyle.Danger);
        });

        const row = new ActionRowBuilder().addComponents(reminderButtons);

        const embed = {
            color: 0xFFA500,
            title: "🗑️ Select a Reminder to Delete",
            description: `Here are the reminders you can delete:\n\n${reminderList}`,
            timestamp: new Date()
        };

        await interaction.reply({ embeds: [embed], components: [row] });

        const filter = i => i.customId.startsWith('delete_') && i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            const selectedId = i.customId.split('_')[1];
            const selectedChore = filteredChores.find(r => r.id == selectedId);
            if (selectedChore) {
                reminders = reminders.filter(r => r.id !== selectedChore.id);
                saveReminders();

                const confirmationEmbed = {
                    color: 0xFF0000,
                    title: "🗑️ Chore Deleted",
                    description: `Chore containing **"${selectedChore.message}"** has been removed.`,
                    timestamp: new Date()
                };

                await i.update({ embeds: [confirmationEmbed], components: [] });
                collector.stop();
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                await interaction.editReply({ content: "❌ You did not select a reminder in time.", embeds: [], components: [] });
            }
        });
    }

    if (commandName === 'chores') {
        if (reminders.length === 0) {
            await interaction.reply({ embeds: [{ color: 0xFFFF00, title: "📋 No Active Chores", description: "There are currently no chores assigned." }] });
            return;
        }

        const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const choresByUser = {};

        // Group chores by user
        for (const chore of reminders) {
            const userId = chore.user ? chore.user.toString() : "Unassigned";
            if (!choresByUser[userId]) {
                choresByUser[userId] = {};
                daysOfWeek.forEach(day => (choresByUser[userId][day] = []));
            }
            const cronParts = chore.cronSchedule.split(" ");
            if (cronParts.length === 5 && cronParts[2] === "*") {
                const dayIndex = parseInt(cronParts[4]);
                if (!isNaN(dayIndex) && dayIndex >= 0 && dayIndex <= 6) {
                    const day = daysOfWeek[dayIndex];
                    choresByUser[userId][day].push(chore.message);
                }
            }
        }

        const userMappings = {
            "240357041267277825": "Captain Ducky",
            "296462814195744769": "Botl",
            "172979233260437505": "Kirkland"
        };

        let choreEmbed = {
            color: 0x3498DB,
            title: "📌 Weekly Chore Schedule",
            description: "Here are the assigned chores for the week:",
            fields: []
        };

        Object.keys(choresByUser).forEach(userId => {
            const username = userMappings[userId] || "Unknown User";
            let choreDetails = "";

            daysOfWeek.forEach(day => {
                const chores = choresByUser[userId][day] || [];
                if (chores.length) {
                    choreDetails += `**${day}:** ${chores.map(chore => `**${chore}**`).join(", ")}\n`;
                }
            });

            choreEmbed.fields.push({
                name: `🧹 ${username}`,
                value: choreDetails || "No chores assigned",
                inline: true
            });
        });

        if (choreEmbed.fields.length === 0) {
            choreEmbed.description = "No active chores scheduled.";
        }

        await interaction.reply({ embeds: [choreEmbed] });
    }

    if (commandName === 'triggerreminder') {
        if (reminders.length === 0) {
            await interaction.reply("No reminders to trigger.");
            return;
        }

        const reminderId = options.getInteger('id');
        const reminder = reminders.find(r => r.id === reminderId);

        if (!reminder) {
            await interaction.reply(`⚠️ No reminder found with ID **${reminderId}**.`);
            return;
        }
        if (reminder.user) {
            try {
                await interaction.deferReply({ ephemeral: true });
                const user = await client.users.fetch(reminder.user);
                const embed = {
                    color: 0xFFCC00,
                    title: "🔔 Manual Chore Reminder!",
                    description: `You have the following task(s) assigned today:\n\n**${reminder.message}**`,
                    timestamp: new Date()
                };
                await user.send({ embeds: [embed] });
                await interaction.editReply({ content: `✅ Reminder sent to <@${reminder.user}> via DM.` });
            } catch (error) {
                console.error(`Failed to send DM to user ${reminder.user}:`, error);
                await interaction.editReply("⚠️ Failed to send DM.");
            }
        } else {
            await interaction.reply("⚠️ No user assigned to this reminder.");
        }
    }

    if (commandName === 'clearchannel') {
        if (interaction.user.id !== "172979233260437505") {
            await interaction.reply({ content: "⛔ You lack permission to use this command.", ephemeral: true });
            return;
        }

        const channel = interaction.channel;
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            await channel.bulkDelete(messages, true);
            await interaction.reply({ content: "✅ Channel cleared!", ephemeral: true });
        } catch (error) {
            console.error("Error clearing channel:", error);
            await interaction.reply({ content: "⚠️ Failed to clear messages. Make sure I have the correct permissions.", ephemeral: true });
        }
    }

    if (commandName === 'duck') {
        try {
            const response = await axios.get('https://random-d.uk/api/v2/random');
            if (response.data && response.data.url) {
                const embed = {
                    color: 0xFFD700,
                    title: "🦆 Random Duck!",
                    image: { url: response.data.url }
                };

                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply("⚠️ Could not retrieve a duck image at this time.");
            }
        } catch (error) {
            console.error("Error fetching duck image:", error);
            await interaction.reply("⚠️ Failed to retrieve a duck image.");
        }
    }

    if (commandName === 'capybara') {
        try {
            const response = await axios.get('https://api.capy.lol/v1/capybara?json=true');
            if (response.data && response.data.data.url) {
                const embed = {
                    color: 0x964B00,
                    title: "🦫 Random Capybara!",
                    image: { url: response.data.data.url }
                };
    
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply("⚠️ Could not retrieve a capybara image at this time.");
            }
        } catch (error) {
            logErrorToDiscord(error);
            await interaction.reply("⚠️ Failed to retrieve a capybara image.");
        }
    }
    
    if (commandName === 'frog') {
        const randomNumber = String(Math.floor(Math.random() * 54) + 1).padStart(4, '0'); // Ensures format "0001" to "0054"
        const frogImageUrl = `http://www.allaboutfrogs.org/funstuff/random/${randomNumber}.jpg`;

        const embed = {
            color: 0x00FF00,
            title: "🐸 Random Frog!",
            image: { url: frogImageUrl }
        };

        await interaction.reply({ embeds: [embed] });
    }
});

async function analyzeEmailWithChatGPT(emailText) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o",
            messages: [
            { 
            role: "system", 
            content: "Extract bill details from the email content and return only a valid JSON object with the following structure, without Markdown formatting or code blocks: { \"company\": \"Company Name\", \"dueDate\": \"MM/DD/YYYY\", \"amountDue\": \"$Amount\", \"paymentLink\": \"URL\" }" 
        },
                { role: "user", content: emailText }
            ]
        })
    });

    const data = await response.json();
    console.log("OpenAI API Response:", JSON.stringify(data, null, 2)); // Debugging log

    if (!data.choices || !data.choices[0].message.content) {
        console.error("ChatGPT did not return a valid response.");
        return null;
    }
 
    try {
        console.log("Raw GPT Response:", data.choices[0].message.content);
 
        return JSON.parse(data.choices[0].message.content);
 
    } catch (error) {
        console.error("Failed to parse JSON from ChatGPT response:", error);
        return {
            company: "Not Found",
            dueDate: "Not Found",
            amountDue: "Not Found",
            paymentLink: "Not Found"
        };
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        const logChannel = await client.channels.fetch("1352011403200041135");
        await logChannel.send("✅ Bot is starting up...");
    } catch (error) {
        logErrorToDiscord(error);
    }
    loadReminders(); // Load reminders when the bot starts
    startZohoMonitor(); // Start monitoring Zoho inbox
});

// Set bot status based on Home Assistant security system
const alarmEntityId = process.env.HOME_ASSISTANT_ALARM_ENTITY_ID;
const homeAssistantUrl = process.env.HOME_ASSISTANT_URL;
const homeAssistantToken = process.env.HOME_ASSISTANT_TOKEN;

async function updateAlarmStatus() {
    try {
        const haResponse = await axios.get(`${homeAssistantUrl}/api/states/${alarmEntityId}`, {
            headers: {
                "Authorization": `Bearer ${homeAssistantToken}`,
                "Content-Type": "application/json"
            }
        });

        const state = haResponse.data.state;
        const presenceText = state === "armed_away" || state === "armed_home"
            ? "🔒 Security: Armed"
            : state === "disarmed"
            ? "🔓 Security: Disarmed"
            : `Security: ${state}`;

        client.user.setPresence({
            activities: [{ name: presenceText }],
            status: 'online'
        });
    } catch (err) {
        console.error("Failed to fetch Home Assistant status:", err);
        logErrorToDiscord(err);
    }
}

// Run initially and then every 5 minutes
updateAlarmStatus();
setInterval(updateAlarmStatus, 5 * 60 * 1000);

client.login(process.env.TOKEN);
    