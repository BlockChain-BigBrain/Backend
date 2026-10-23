#!/bin/sh
# Root access is used only for disposable test databases in the local container.
exec docker exec -i track-ai-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql "$@"' sh "$@"
