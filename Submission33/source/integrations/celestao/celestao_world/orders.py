"""Operator tool for paid orders with no report yet. Shows no wallet or birth data.

  python -m celestao_world.orders list
  python -m celestao_world.orders refund 0x<order id>

refund ends the run here. World sees the failure at its next delivery attempt and refunds the order. No report can be saved after it.
"""
import argparse,json,sqlite3,sys
from .config import Settings
from .vault import Vault,VaultError,Missing

def main(argv=None,settings=None):
    parser=argparse.ArgumentParser(prog='celestao_world.orders')
    commands=parser.add_subparsers(dest='command',required=True)
    commands.add_parser('list')
    commands.add_parser('refund').add_argument('order')
    args=parser.parse_args(argv)
    settings=settings or Settings.from_environment()
    if not settings.enabled:
        print('WALLET_NOT_ENABLED',file=sys.stderr);return 2
    vault=Vault(settings.database,settings.storage_key)
    try:
        if args.command=='list':
            print(json.dumps(vault.stuck(),indent=1))
            # An empty result from an empty database usually means the wrong data directory, not that nothing is stuck.
            if vault.db.execute('SELECT COUNT(*) FROM runs').fetchone()[0]==0:print('WARNING: this database has no runs at all: '+str(settings.database),file=sys.stderr)
            return 0
        changed=vault.abandon(args.order)
        print('ENDED: World refunds it at its next delivery attempt' if changed else 'ALREADY_FAILED');return 0
    except (VaultError,sqlite3.Error) as error:
        print(str(error),file=sys.stderr);return 1
    finally:vault.close()

if __name__=='__main__':sys.exit(main())
