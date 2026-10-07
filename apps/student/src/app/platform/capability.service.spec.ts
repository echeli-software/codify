import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NetworkStatusService } from '../offline/network-status.service';
import { CAPABILITIES, CapabilityService } from './capability.service';

describe('CapabilityService', () => {
  it('reports every online-only capability unavailable while offline', () => {
    const online = signal(true);
    TestBed.configureTestingModule({
      providers: [{ provide: NetworkStatusService, useValue: { online } }],
    });
    const caps = TestBed.inject(CapabilityService);
    for (const c of CAPABILITIES) expect(caps.available(c)()).toBe(true);
    online.set(false);
    for (const c of CAPABILITIES) {
      expect(caps.available(c)()).toBe(false);
      expect(caps.reasonKey(c)).toBe(`studentPlatform.capability.${c}.reason`);
    }
    expect(caps.available('shop')).toBe(caps.available('shop'));
  });
});
