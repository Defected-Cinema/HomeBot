require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("addchore")
    .setDescription("Set a chore")
    .addStringOption(option =>
      option.setName("message")
        .setDescription("Name of Chore")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("type")
        .setDescription("Type of reminder")
        .setRequired(true)
        .addChoices(
          { name: "Day of the week", value: "day-of-week" },
          { name: "Day of the month", value: "day-of-month" }
        ))
    .addStringOption(option =>
      option.setName("day")
        .setDescription("Day (e.g., Monday or 5)")
        .setRequired(true))
    .addUserOption(option =>
      option.setName("user")
        .setDescription("Assign to a user")
        .setRequired(false))
    .addStringOption(option =>
      option.setName("repeat")
        .setDescription("Repeat frequency")
        .setRequired(false)
        .addChoices(
          { name: "Weekly", value: "weekly" },
          { name: "Bi-Weekly", value: "bi-weekly" },
          { name: "Monthly", value: "monthly" }
        )),
    
  new SlashCommandBuilder()
    .setName("chores")
    .setDescription("List all current chores"),

  new SlashCommandBuilder()
    .setName("triggerreminder")
    .setDescription("Manually trigger a reminder for debugging")
    .addIntegerOption(option =>
      option.setName("id")
        .setDescription("Reminder ID to trigger")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("deletechore")
    .setDescription("Delete a chore based on the chore description")
    .addStringOption(option =>
      option.setName("message")
        .setDescription("Chore description to delete")
        .setRequired(true)),
  // Only user ID 172979233260437505 can trigger this command
  new SlashCommandBuilder()
    .setName("clearchannel")
    .setDescription("Clears all messages in the current channel (Admin only)"),
  
  new SlashCommandBuilder()
    .setName("frog")
    .setDescription("Fetches and posts a random frog image"),

  new SlashCommandBuilder()
    .setName("capybara")
    .setDescription("Fetches and posts a random capybara image"),

  new SlashCommandBuilder()
    .setName("duck")
    .setDescription("Fetches and posts a random duck image"),
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("Registering commands...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, '1351258637279953039'),
      { body: commands }
    );
    console.log("Commands registered!");
  } catch (error) {
    console.error(error);
  }
})();