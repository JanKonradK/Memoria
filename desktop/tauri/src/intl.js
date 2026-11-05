// Only the Intl.DateTimeFormat surface used by shared clocks and validation.
// Rust supplies real IANA offsets, including daylight saving transitions.
globalThis.Intl = {
  DateTimeFormat: function (_locale, options = {}) {
    const zone = options.timeZone || globalThis.__memoriaTimeZone;
    if (globalThis.__memoriaZoneOffset(zone, Date.now()) == null) throw new RangeError('Invalid time zone');
    return {
      resolvedOptions: () => ({ timeZone: zone, locale: 'en-US', numberingSystem: 'latn', calendar: 'gregory' }),
      format: () => '',
      formatToParts: (date) => {
        const at = Number(date);
        const offset = globalThis.__memoriaZoneOffset(zone, at);
        if (offset == null || !Number.isFinite(at)) throw new RangeError('Invalid date');
        const local = new Date(at + offset * 1000);
        return Object.entries({
          year: local.getUTCFullYear(),
          month: local.getUTCMonth() + 1,
          day: local.getUTCDate(),
          hour: local.getUTCHours(),
          minute: local.getUTCMinutes(),
          second: local.getUTCSeconds(),
          era: 'AD',
        }).map(([type, value]) => ({ type, value: String(value) }));
      },
    };
  },
};
