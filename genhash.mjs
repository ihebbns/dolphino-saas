import bcrypt from 'bcryptjs'
const hash = await bcrypt.hash('dolphino123', 10)
console.log(hash)
