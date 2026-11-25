package app.memoria.tracker;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The HoYoLAB request logic that needs no Android or JSON runtime. */
public class ConnectorPluginTest {

    @Test
    public void dsMatchesAKnownAnswer() throws Exception {
        assertEquals("6s25p5ox5y14umn1p61aqyyvbvvl3lrt", ConnectorPlugin.DS_SALT);
        // Computed independently (Node's crypto.createHash('md5')) from genshin.py's overseas salt.
        assertEquals("1700000000,AbCdEf,52762c606b53f6830e4692f53664105e", ConnectorPlugin.ds(1_700_000_000L, "AbCdEf"));
        assertEquals("1,abcdef,17926259eeb14bf6d1311c3e42f57c8c", ConnectorPlugin.ds(1L, "abcdef"));
        assertEquals("900150983cd24fb0d6963f7d28e17f72", ConnectorPlugin.md5Hex("abc"));
    }

    @Test
    public void noteUrlsTryTheSgGatewayFirst() {
        String role = "?server=prod_official_eur&role_id=700000001";
        assertArrayEquals(
            new String[] {
                "https://sg-public-api.hoyolab.com/event/game_record/hkrpg/api/note" + role,
                "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note" + role,
            },
            ConnectorPlugin.noteUrls("hsr", "prod_official_eur", "700000001")
        );
        role = "?server=os_euro&role_id=700000001";
        assertArrayEquals(
            new String[] {
                "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote" + role,
                "https://bbs-api-os.hoyolab.com/game_record/genshin/api/dailyNote" + role,
            },
            ConnectorPlugin.noteUrls("genshin", "os_euro", "700000001")
        );
        assertArrayEquals(
            new String[] {
                "https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz/note?server=prod_gf_eu&role_id=1500000001",
            },
            ConnectorPlugin.noteUrls("zzz", "prod_gf_eu", "1500000001")
        );
        assertEquals(0, ConnectorPlugin.noteUrls("wuwa", "x", "1").length);
        assertEquals(0, ConnectorPlugin.noteUrls(null, "x", "1").length);
    }

    @Test
    public void noteAnswersDecideWhetherToFallBack() {
        assertEquals(ConnectorPlugin.NOTE_OK, ConnectorPlugin.noteAnswer(0, true));
        assertEquals(ConnectorPlugin.NOTE_RETRY, ConnectorPlugin.noteAnswer(0, false));
        assertEquals(ConnectorPlugin.NOTE_CAPTCHA, ConnectorPlugin.noteAnswer(1034, false));
        for (int code : new int[] { -100, 10001, 10102 }) {
            assertEquals(ConnectorPlugin.NOTE_FINAL, ConnectorPlugin.noteAnswer(code, false));
        }
        for (int code : new int[] { -10001, -1, 10101 }) {
            assertEquals(ConnectorPlugin.NOTE_RETRY, ConnectorPlugin.noteAnswer(code, false));
        }
        assertTrue(ConnectorPlugin.noteError(10102).contains("private"));
        assertTrue(ConnectorPlugin.noteError(-10001).contains("-10001"));
    }

    @Test
    public void theMostTellingFailureIsKept() {
        ConnectorPlugin.Failure failure = new ConnectorPlugin.Failure();
        failure.keep(null, "offline");
        failure.keep(-10001, "gateway");
        assertEquals(Integer.valueOf(-10001), failure.retcode);
        failure.keep(null, "offline again");
        assertEquals("gateway", failure.error);
        failure.keep(-1, "other");
        assertEquals(Integer.valueOf(-1), failure.retcode);
        // Ties keep the first: the primary gateway's answer.
        failure.keep(10101, "later");
        assertEquals("other", failure.error);

        ConnectorPlugin.Failure empty = new ConnectorPlugin.Failure();
        empty.keep(0, "no notes");
        assertNull(empty.retcode);
        assertEquals("no notes", empty.error);
    }

    @Test
    public void starRailChecksInOnItsOwnHostFirst() {
        assertEquals("e202303301540311", ConnectorPlugin.checkinActId("hsr"));
        String[][] hosts = ConnectorPlugin.checkinHosts("hsr");
        assertEquals(2, hosts.length);
        assertArrayEquals(new String[] { "https://sg-public-api.hoyolab.com/event/luna/hkrpg/os", "hkrpg" }, hosts[0]);
        assertArrayEquals(new String[] { "https://sg-public-api.hoyolab.com/event/luna/os", null }, hosts[1]);
        assertEquals("zzz", ConnectorPlugin.checkinHosts("zzz")[0][1]);
        assertNull(ConnectorPlugin.checkinHosts("genshin")[0][1]);
        assertEquals(0, ConnectorPlugin.checkinHosts("wuwa").length);
        assertNull(ConnectorPlugin.checkinActId(null));
        for (int code : new int[] { 0, -5003, -100, 10001 }) assertTrue(ConnectorPlugin.checkinSettled(code));
        for (int code : new int[] { -10001, -1, -500012 }) assertFalse(ConnectorPlugin.checkinSettled(code));
    }

    @Test
    public void rolesComeFromBindingsOrRecordCards() {
        assertEquals("genshin", ConnectorPlugin.presetForCardGame(2));
        assertEquals("hsr", ConnectorPlugin.presetForCardGame(6));
        assertEquals("zzz", ConnectorPlugin.presetForCardGame(8));
        assertNull(ConnectorPlugin.presetForCardGame(1));
        String header = "ltuid_v2=12345; ltoken_v2=v2_tok; ltmid_v2=mid";
        assertEquals("12345", ConnectorPlugin.cookieValue(header, "ltuid_v2"));
        assertEquals("mid", ConnectorPlugin.cookieValue(header, "ltmid_v2"));
        assertNull(ConnectorPlugin.cookieValue(header, "account_id_v2"));
        assertNull(ConnectorPlugin.cookieValue(null, "ltuid_v2"));
    }
}
