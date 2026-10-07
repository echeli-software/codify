import { CertificatesService } from './certificates.service.js';

const cert = (serial: string) => ({
  id: 'c',
  userId: 'u',
  courseId: 'k',
  serial,
  recipientName: 'Ana',
  courseTitle: 'React',
  isCapstone: false,
  issuedAt: new Date('2026-10-01T00:00:00Z'),
});

describe('CertificatesService serials', () => {
  it('issues 80-bit CDFY-XXXX-XXXX-XXXX-XXXX serials', async () => {
    const created: string[] = [];
    const prisma = {
      certificate: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(
          async ({ data }: { data: { serial: string } }) => (
            created.push(data.serial),
            cert(data.serial)
          ),
        ),
      },
      course: {
        findFirst: async () => ({
          id: 'k',
          status: 'PUBLISHED',
          sourceLocale: 'pt-BR',
          slug: 'react',
          isCapstone: false,
        }),
      },
      lesson: { findMany: async () => [{ id: 'l1' }] },
      progress: { count: async () => 1 },
      user: { findUniqueOrThrow: async () => ({ displayName: 'Ana' }) },
      contentTranslation: { findFirst: async () => ({ value: 'React' }) },
    };
    const svc = new CertificatesService(prisma as never);
    const view = await svc.claim('u', 'k');
    expect(view.serial).toMatch(/^CDFY(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    expect(created).toHaveLength(1);
  });

  it('verifies legacy and current serials, normalizing typed input', async () => {
    const prisma = {
      certificate: {
        findUnique: jest.fn(async ({ where }: { where: { serial: string } }) =>
          ['CDFY-AB12-CD34', 'CDFY-AB10-CD14-0000-ZZZZ'].includes(where.serial)
            ? cert(where.serial)
            : null,
        ),
      },
    };
    const svc = new CertificatesService(prisma as never);
    expect((await svc.verify('CDFY-AB12-CD34'))?.serial).toBe('CDFY-AB12-CD34');
    expect((await svc.verify(' cdfy-ab1o-cdi4-oooo-zzzz '))?.serial).toBe(
      'CDFY-AB10-CD14-0000-ZZZZ',
    );
    expect(await svc.verify('garbage')).toBeNull();
    expect(prisma.certificate.findUnique).toHaveBeenCalledTimes(2); // garbage never hits the DB
  });
});
