


===========================
Docker steps and commands, always use these steps to create docker image and run:

1. Edit code locally 
2. Upload updated code files and .env to /www/wwwroot/ftr/ (don't upload package.json/package-lock.json)
3. cd /www/server/panel/data/compose/ftr-app 
4. docker compose down 
5. docker rm -f ftr-app 		(if needed) 
6. docker compose up -d --build 	(if code changed) 
   docker compose up -d         	(if only compose config changed) 
7. docker logs ftr-app --tail 20 	(verify) 


# Verify ALL vars are loaded correctly
docker exec ftr-app printenv | grep -E "EMAIL|OAUTH|DB|PORT"

# Setup in .yaml file to read from real source only.
    env_file:
      - /www/wwwroot/ftr/.env        # ← single source of truth



=== Run Database server ===

= Start/Stop database: net <start/stop> <Database Service: MySQLSSL>
	net start MySQLSSL

= Run Webserver ===
1. Run from the webserver folder
2. Start node server: node <auto restart: --watch> <node server>
	node src/index.js --watch
      	
Create info in package.json:
	"scripts": {
       		"start": "node src/index.js",
       		"dev": "nodemon src/index.js"
   	}

# Then run on public as below
	npm start or npm run dev    # run dev, will refresh when code change



------------------------------

=== Create tunnel to test with using ngrok ===
Your Authtoken: use this personal Authtoken to authenticate ngrok agents, SDKs, 
and the Kubernetes Operator for your own projects.

	34PTbCPE0dlC9328AHSJ9pPKH6O_3qLHEWvcFxvp9JCyXKy9A

1. Create ngrok account from ngrok.com (ssaelao@yahoo.com / $tinroad87)
2. Download "ngrok.exe" a standalone executable with zero run time dependencies from ngrok.com and run
3. From command line, run the following command to add your authtoken to create ngrok.yml

	ngrok config add-authtoken 34PTbCPE0dlC9328AHSJ9pPKH6O_3qLHEWvcFxvp9JCyXKy9A

4. Deploy our web application from port 3000
5. Start the ngrok agent with port 3000
	ngrok http 3000

6. From end-user click provided link: eg. "https://cythia-nonformal-undefeatedly.ngrok-free.dev", 
   it will redirect to our web application from port 3000

------------------------------
FTR Project Dependency Modules:

# Project modules
npm install puppeteer nodemailer node-cron multer csv-parse bcrypt express-session dotenv googleapis

# Puppeteer for PDF generating 
# Installs the OS libraries (graphics libraries, sound libraries, fonts, etc.) 
# that Chrome needs to run. Run on Linux once only, Windows already has it.
npx puppeteer system-deps

# (or npx.cmd on Windows) manually download chrome.
npx puppeteer browsers install chrome 


------------------------------
=== LINE OA ===

Provider: "Unicon Container Services" 
ProviderID: 2005147845

1.Messaging API Channel:
    Channel ID: 2010085130
    Channel Secret: 7286a35f00f8fc907937e0067c17a4c5
    Your user ID: Uba3a143f7dc062bf0b388c1d26fac28c

2.LINE Login Channel:
    Channel name: Unicon_channel
    Channel ID: 2010196890
    Email address: ssaelao@yahoo.com
    Permissions: PROFILE, OPENID_CONNECT
    Channel secret: 392a7f5f3a042c1b5976b9a597f12121
    Channel access token:
mkSC69+JrhBq+aCwXfMIF1qYHteKrS0DyuUWfvS0YckqTEPpIuEJIw3bFq4HrxRLBjRbFhT7KZIQUAY6uqM+2wKgAHm79zBc3lx9h2f/KzzUkZQXE9QfqyH0fY0Pg/M1DCOZxkYnCHU2Q1qYW2QlNgdB04t89/1O/w1cDnyilFU=

3. LIFF
    LIFF app name: UNICON_FTR_LIFF
    LIFF ID: 2010196890-kJW56aX3
    LIFF URL: https://liff.line.me/2010196890-kJW56aX3
    Size: Compact
