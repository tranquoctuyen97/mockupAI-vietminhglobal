FROM firefart/requesttracker@sha256:61542e700818c1422ee476750fa33dfd5470a407329f2586df6fd00a6b8d67a8

USER root

COPY RT_SiteConfig.pm /opt/rt/etc/RT_SiteConfig.d/90-mockupai.pm
COPY msmtprc /etc/msmtprc
COPY bin/mailbox-secret-helper /usr/local/bin/mailbox-secret-helper

RUN chmod 0755 /usr/local/bin/mailbox-secret-helper \
 && chown root:rt /etc/msmtprc /opt/rt/etc/RT_SiteConfig.d/90-mockupai.pm \
 && chmod 0640 /etc/msmtprc /opt/rt/etc/RT_SiteConfig.d/90-mockupai.pm \
 && perl -I/opt/rt/lib -MRT -e 'die "Unexpected RT version $RT::VERSION\n" unless $RT::VERSION eq "6.0.3"' \
 && perl -c /opt/rt/etc/RT_SiteConfig.d/90-mockupai.pm

USER rt
