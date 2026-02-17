from django.contrib import admin

from .models import (
    MailboxConfig,
    EmailIngested,
    ParseResult,
    MappingRule,
    MappingResult,
    SDTRequest,
    SDTQueueItem,
    SiteCodeMapping,
)


admin.site.register(MailboxConfig)
admin.site.register(EmailIngested)
admin.site.register(ParseResult)
admin.site.register(MappingRule)
admin.site.register(MappingResult)
admin.site.register(SDTRequest)
admin.site.register(SDTQueueItem)
admin.site.register(SiteCodeMapping)
