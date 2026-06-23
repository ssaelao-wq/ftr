

===========================
**Step 1: Create Your Description File**
Run this in your terminal to quickly create a plain text version file (eg. CHANGELOG.md).

	echo "Version: 1.0.0 - Initial stable release with dashboard" > CHANGELOG.md
	echo "Version: 1.0.1 - Cosmatic changes" >> CHANGELOG.md

**Step 2: Track and Commit Your Code**
This saves your project files and your new description file into Git locally.

	git add .
	git commit -m "Release version 1.0.0 with full description"
	git commit -m "Release version 1.0.1"

**Step 3: Create the Version Tag**
This stamps the version number onto your latest commit.

	git tag -a v1.0.0 -m "Release version 1.0.0"
	git tag -a v1.0.1 -m "Release version 1.0.1"

**Step 4: Push Everything to GitHub**
This sends both your code updates and your version tags to your online repository.

	git push origin main
	git push origin v1.0.0
	git push origin v1.0.1

---------------

**Go Backward Later:** jump back to the exact version in the future.

	Checkout code to existing folder:
	git checkout v1.0.0
	
	Checkout code to a specific folder:
	git worktree add C:\Users\Somboon\LocalData\1-SSL\Dev\ftr-BK\test v1.0.0

===========================
# Docker steps and commands to create docker image and run:

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


===========================
# Point LINE OA LIFF endpoint to webserver to let Rich menu connect to webpage

1. https://developers.line.biz/
2. Login
3. Select project "Unicon Container Services" -> Unicon_channel (LINE Login)
4. Select LIFF app name
5. Edit Endpoint URL = https://ftr.uniconwebapp.com

===========================
# Run Database server

# Start/Stop database: net <start/stop> <Database Service: MySQLSSL>
	net start MySQLSSL

# Run Webserver
1. Run from the webserver folder
2. Start node server: node <auto restart: --watch> <node server>
	node src/index.js --watch
      	
# Create info in package.json:
	"scripts": {
       		"start": "node src/index.js",
       		"dev": "nodemon src/index.js"
   	}

# Then run on public as below
	npm start or npm run dev    # run dev, will refresh when code change


===========================
# Setup cronjob

Setup in aaPanel
1. Navigate to Cron in the aaPanel side menu.
2. Add a new cron task running PDF engine:
    - Type: Shell Script
    - Name: FTR-PDF-Engine
    - Execution Cycle: Daily at 01:00
    - Script Content: cd /www/wwwroot/ftr && node src/cron_batch.js >> cron_batch.log 2>&1
    - Script Content with Docker: docker exec ftr-app node src/cron_batch.js > /www/wwwroot/ftr/cron_batch.log 2>&1


3. Add a second task running Cleanup data:
    - Type: Shell Script
    - Name: FTR-Data-Cleanup
    - Execution Cycle: Daily at 02:00
    - Script Content: cd /www/wwwroot/ftr && node src/ftr_cleanup_data.js >> cron_cleanup.log 2>&1
    - Script Content with Docker: docker exec ftr-app node src/ftr_cleanup_data.js > /www/wwwroot/ftr/cron_cleanup.log 2>&1

- Testing command directly, not from cronjob
docker exec ftr-app node src/cron_batch.js
docker exec ftr-app node src/ftr_cleanup_data.js

# package.json
{
  "name": "ftr",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "cleanup": "node src/ftr_cleanup_data.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
cd /www/wwwroot/ftr && npm run cleanup >> cron_cleanup.log 2>&1

===========================

# Create tunnel to test with using ngrok
# Your Authtoken: use this personal Authtoken to authenticate ngrok agents, SDKs, 
# and the Kubernetes Operator for your own projects.

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

===========================
FTR Project Dependency Modules:

# Project modules
npm install puppeteer nodemailer node-cron multer csv-parse bcrypt express-session dotenv googleapis

# Puppeteer for PDF generating 
# Installs the OS libraries (graphics libraries, sound libraries, fonts, etc.) 
# that Chrome needs to run. Run on Linux once only, Windows already has it.
npx puppeteer system-deps

# (or npx.cmd on Windows) manually download chrome.
npx puppeteer browsers install chrome 


===========================
# LINE OA

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
