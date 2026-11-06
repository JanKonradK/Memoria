import { gameServers, otherZones, parseServerValue, serverValue, utcLabel, type ServerPick } from '../server-choice';
import { Select } from './ui';

/**
 * Pick the server an account plays on: the game's own servers first, then any
 * other timezone for a server Memoria does not list. Nothing is chosen for the
 * player — with no value it asks.
 */
export function ServerSelect({
  game,
  value,
  onChange,
  className = '',
  ...props
}: {
  game: { name: string; short: string; presetKey?: string };
  value: ServerPick | null;
  onChange: (pick: ServerPick) => void;
  className?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  const servers = gameServers(game);
  const current = serverValue(game, value);
  const named = current.startsWith('server:');
  return (
    <Select
      {...props}
      className={className}
      value={current}
      onChange={(event) => onChange(parseServerValue(game, event.target.value))}
    >
      {!value && (
        <option value="" disabled>
          Choose a server…
        </option>
      )}
      {servers.length > 0 && (
        <optgroup label={`${game.short} servers`}>
          {servers.map((server) => (
            <option key={server.id} value={`server:${server.id}`}>
              {server.label} ({utcLabel(server.tz)})
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={servers.length > 0 ? 'Other time zones' : 'Time zones'}>
        {otherZones(named ? undefined : value?.tz).map((zone) => (
          <option key={zone.tz} value={`tz:${zone.tz}`}>
            {zone.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}
