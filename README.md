# GearShift Auto Parts

This workspace now includes a SQLite-backed login flow for the GearShift demo.

## Run

```bash
npm install
npm start
```

Then open:

http://localhost:3000/login.html
http://localhost:3000/index.html

## Seed accounts

- Admin email: `admin@gmail.com`
- Admin password: `admin123`
- User email: `user@gmail.com`
- User password: `user123`
- user email: bidhigya@gmail.com
- password: bidhigya

## Notes

- All users are cleared and reseeded on server start.
- New accounts are stored in `gearshift.db`.
- Passwords are hashed with `scrypt` before being saved.
- The database engine is `sql.js`, so no native build tools are required.
