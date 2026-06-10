@echo off
curl -v -X POST "https://api.line.me/v2/bot/richmenu" ^
-H "Authorization: Bearer mkSC69+JrhBq+aCwXfMIF1qYHteKrS0DyuUWfvS0YckqTEPpIuEJIw3bFq4HrxRLBjRbFhT7KZIQUAY6uqM+2wKgAHm79zBc3lx9h2f/KzzUkZQXE9QfqyH0fY0Pg/M1DCOZxkYnCHU2Q1qYW2QlNgdB04t89/1O/w1cDnyilFU=" ^
-H "Content-Type: application/json" ^
-d "{\"size\":{\"width\":1200,\"height\":405},\"selected\":false,\"name\":\"Customer Portal\",\"chatBarText\":\"Main Menu\",\"areas\":[{\"bounds\":{\"x\":0,\"y\":0,\"width\":600,\"height\":405},\"action\":{\"type\":\"uri\",\"label\":\"Adding Customer Info\",\"uri\":\"https://liff.line.me/2010196890-kJW56aX3?target=add_info\"}},{\"bounds\":{\"x\":600,\"y\":0,\"width\":600,\"height\":405},\"action\":{\"type\":\"uri\",\"label\":\"Full Tax Invoice\",\"uri\":\"https://liff.line.me/2010196890-kJW56aX3?target=req_fulltax\"}}]}"
pause