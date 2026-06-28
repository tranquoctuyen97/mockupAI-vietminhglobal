use utf8;

Set($DatabaseType, 'Pg');
Set($DatabaseHost, $ENV{RT_POSTGRES_HOST} || 'postgres');
Set($DatabasePort, $ENV{RT_POSTGRES_PORT} || '5432');
Set($DatabaseName, $ENV{RT_POSTGRES_DB} || 'rt');
Set($DatabaseUser, $ENV{RT_POSTGRES_USER} || 'rt');
Set($DatabasePassword, $ENV{RT_POSTGRES_PASSWORD} || '');

Set($rtname, $ENV{RT_WEB_DOMAIN} || 'support.local');
Set($Organization, $ENV{RT_WEB_DOMAIN} || 'support.local');
Set($WebDomain, $ENV{RT_WEB_DOMAIN} || '127.0.0.1');
Set($WebPort, $ENV{RT_WEB_PORT} || 8082);
Set($WebPath, $ENV{RT_WEB_PATH} && $ENV{RT_WEB_PATH} ne '/' ? $ENV{RT_WEB_PATH} : '');
Set($CanonicalizeRedirectURLs, 1);
Set($WebSecureCookies, 1);

Set($MailCommand, 'sendmailpipe');
Set($SendmailPath, '/usr/bin/msmtp');
Set($SendmailArguments, '--read-envelope-from --read-recipients');
Set($CorrespondAddress, '');
Set($CommentAddress, '');

Set($LogToSTDERR, $ENV{RT_LOG_LEVEL} || 'info');
Set($LogStackTraces, 'error');
Set($HideArticleSearchOnReplyCreate, 1);

1;
