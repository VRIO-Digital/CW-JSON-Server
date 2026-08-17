#!/bin/bash

HEALTH_URL="http://18.205.228.143:4000/health"
APP_NAME="mock-server"
PROJECT_DIR="/home/ubuntu/CW-JSON-Server"

while true
do
    if curl -sf --max-time 3 "$HEALTH_URL" > /dev/null
    then
        echo "$(date) - Health OK"
    else
        echo "$(date) - Health FAILED"

        if pm2 describe "$APP_NAME" > /dev/null 2>&1
        then
            echo "$(date) - Restarting $APP_NAME"
            pm2 restart "$APP_NAME"
        else
            echo "$(date) - Starting $APP_NAME"
            cd "$PROJECT_DIR"
            pm2 start npm --name "$APP_NAME" -- run mock -- 4000
        fi

        sleep 10
    fi

    sleep 5
done


# chmod +x health-check.sh

# ./health-check.sh

# pm2 start ./health-check.sh --name "mock-health-check" --interpreter bash

# pm2 status

# pm2 save