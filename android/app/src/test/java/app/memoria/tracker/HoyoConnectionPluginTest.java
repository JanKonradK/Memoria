package app.memoria.tracker;

import org.junit.Test;
import static org.junit.Assert.*;

public class HoyoConnectionPluginTest {
    @Test
    public void officialLoginAddressesRequireHttpsAndExactDomainBoundaries() {
        assertTrue(HoyoConnectionPlugin.allowedLoginUrl("https://www.hoyolab.com/"));
        assertTrue(HoyoConnectionPlugin.allowedLoginUrl("https://ACCOUNT.HOYOVERSE.COM:443/passport"));
        for (String url : new String[] {
            "http://www.hoyolab.com/", "https://hoyolab.com.evil.example/", "https://evilhoyolab.com/",
            "https://hoyolab.com@evil.example/", "https://evil.example@hoyolab.com/", "https://hoyolab.com:8080/",
            "javascript://hoyolab.com/alert(1)", "file://hoyolab.com/path", "https://hoyolab.com\\@evil.example/", "about:blank"
        }) assertFalse(url, HoyoConnectionPlugin.allowedLoginUrl(url));
    }

    @Test
    public void onlyRequiredSessionCookieNamesLeaveTheCookieStore() {
        assertEquals("ltoken_v2=test-token; ltuid_v2=12345; ltmid_v2=mid",
            HoyoConnectionPlugin.filterCookies("unrelated=private; ltoken_v2=test-token; ltuid_v2=12345; ltmid_v2=mid; analytics=other"));
        assertEquals("", HoyoConnectionPlugin.filterCookies("ltuid_v2=12345"));
        assertEquals("", HoyoConnectionPlugin.filterCookies("ltoken_v2=; ltuid_v2=12345"));
        assertEquals("", HoyoConnectionPlugin.filterCookies("ltoken_v2=token\r\nInjected: value; ltuid_v2=12345"));
    }

    @Test
    public void accountArgumentsCannotChangeTheRequestHostOrQuery() {
        assertEquals(0, HoyoConnectionPlugin.providerIndex("genshin", "os_euro"));
        assertEquals(1, HoyoConnectionPlugin.providerIndex("hsr", "prod_official_asia"));
        assertEquals(2, HoyoConnectionPlugin.providerIndex("zzz", "prod_gf_eu"));
        assertEquals(-1, HoyoConnectionPlugin.providerIndex("hsr", "os_euro"));
        assertEquals(-1, HoyoConnectionPlugin.providerIndex("genshin", "os_euro&role_id=other"));
        assertEquals(-1, HoyoConnectionPlugin.providerIndex("https://example.com", "os_euro"));
    }

    @Test
    public void protocolDigestMatchesTheDesktopImplementation() throws Exception {
        assertEquals("b2f7cea3edf3390d634472e10d51dbe5", HoyoConnectionPlugin.digest(1600000000L, "abcdef"));
    }

    @Test
    public void discoveryRejectsUnknownGamesAndAccountsFromOtherServers() {
        assertEquals("hk4e_global", HoyoConnectionPlugin.accountBusiness("genshin"));
        assertEquals("hkrpg_global", HoyoConnectionPlugin.accountBusiness("hsr"));
        assertEquals("nap_global", HoyoConnectionPlugin.accountBusiness("zzz"));
        assertNull(HoyoConnectionPlugin.accountBusiness("genshin&game_biz=other"));
        assertTrue(HoyoConnectionPlugin.validAccount("genshin", "712345678", "os_euro"));
        assertTrue(HoyoConnectionPlugin.validAccount("hsr", "712345678", "prod_official_eur"));
        assertTrue(HoyoConnectionPlugin.validAccount("zzz", "1501234567", "prod_gf_eu"));
        assertFalse(HoyoConnectionPlugin.validAccount("genshin", "712345678", "prod_official_eur"));
        assertFalse(HoyoConnectionPlugin.validAccount("genshin", "712345678&x=1", "os_euro"));
        assertFalse(HoyoConnectionPlugin.validAccount("genshin", "123", "os_euro"));
        assertFalse(HoyoConnectionPlugin.validAccount("genshin", null, "os_euro"));
    }
}
