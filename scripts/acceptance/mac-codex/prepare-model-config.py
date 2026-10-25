import json
import os
from pathlib import Path
import sys
import tomllib

source = tomllib.loads((Path.home() / '.codex/config.toml').read_text())
provider, model = source.get('model_provider'), source.get('model')
if not provider or not model or provider not in source.get('model_providers', {}):
    raise RuntimeError('Existing explicit model provider required')
selected = source['model_providers'][provider]
if any(not isinstance(value, (str, bool, int)) for value in selected.values()):
    raise RuntimeError('Provider contains unsupported structured values')
quote = lambda value: json.dumps(value, ensure_ascii=True)
render = lambda value: str(value).lower() if isinstance(value, bool) else quote(value) if isinstance(value, str) else str(value)
lines = [f'model = {quote(model)}', f'model_provider = {quote(provider)}',
         'approval_policy = "never"', 'sandbox_mode = "read-only"',
         'web_search = "disabled"', '[sandbox_workspace_write]', 'network_access = false',
         '', f'[model_providers.{quote(provider)}]']
lines += [f'{quote(key)} = {render(value)}' for key, value in selected.items()]
destination = Path(sys.argv[1]).resolve() / 'config.toml'
destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
with destination.open('x') as output:
    os.chmod(destination, 0o600)
    output.write('\n'.join(lines) + '\n')
tomllib.loads(destination.read_text())
print(json.dumps({'model': model, 'provider': provider, 'isolatedConfigCreated': True}))
