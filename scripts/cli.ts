#!/usr/bin/env node
const [command, ...args] = process.argv.slice(2)
if (command === 'create-user') console.log(`Created local ${args.find((arg) => arg.startsWith('--role='))?.split('=')[1] ?? 'participant'} user.`)
else if (command === 'auth:switch') console.log(`Switched offline session to ${args.find((arg) => arg.startsWith('--user='))?.split('=')[1] ?? 'participant'}.`)
else console.log('Commands: create-user --role=admin --email=admin@local | auth:switch --user=judge1')
