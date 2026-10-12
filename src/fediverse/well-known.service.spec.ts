import { AssetController } from '../assets/asset-controller.decorator';
import type { AppConfigService } from '../config/config.service';
import { WellKnownService } from './well-known.service';

jest.mock('../config/config.service', () => ({
  AppConfigService: class AppConfigService {},
}));

class TestModsAssetController {}

AssetController('mod', 'mods', 'm')(TestModsAssetController);

describe('WellKnownService', () => {
  it('includes asset controller types in the features list', async () => {
    const values: Record<string, unknown> = {
      address: 'hactazia.fr',
      identifier: 'hactazia.fr',
      'http.port': 443,
      'gateway.web': 'https://nox.hactazia.fr/',
      'gateway.ws': 'wss://nox.hactazia.fr/api/ws',
      'gateway.api': 'https://nox.hactazia.fr/api/',
      'instance.name': 'Nox',
      'instance.features': 'user,mod,user',
      'instance.registration': false,
      'instance.instanceCreation': false,
      'instance.instanceCreationByExternal': false,
      'instance.worldCreation': false,
      'instance.worldCreationByExternal': false,
      'instance.avatarCreation': false,
      'instance.avatarCreationByExternal': false,
    };
    const config = {
      get: jest.fn((key: string) => Promise.resolve(values[key])),
      getOptional: jest.fn(() => Promise.resolve(null)),
    } as unknown as AppConfigService;
    const service = new WellKnownService(config);
    jest.spyOn(service, 'pairKeys').mockResolvedValue({
      public: '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----',
      private: 'private',
    });

    const document = await service.noxWellKnown();

    expect(document.features).toEqual(['user', 'mod']);
  });
});
