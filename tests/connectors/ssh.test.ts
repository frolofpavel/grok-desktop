import { describe, it, expect } from 'vitest'
import { isDangerousCommand } from '../../electron/connectors/ssh'

describe('isDangerousCommand', () => {
  it('блокирует rm -rf /', () => {
    expect(isDangerousCommand('rm -rf /')).not.toBeNull()
    expect(isDangerousCommand('rm -rf /var')).not.toBeNull()
    expect(isDangerousCommand('rm -Rf /')).not.toBeNull()
  })

  it('блокирует mkfs', () => {
    expect(isDangerousCommand('mkfs.ext4 /dev/sda')).not.toBeNull()
  })

  it('блокирует dd на устройство', () => {
    expect(isDangerousCommand('dd if=/dev/zero of=/dev/sda')).not.toBeNull()
  })

  it('блокирует passwd', () => {
    expect(isDangerousCommand('passwd root')).not.toBeNull()
    expect(isDangerousCommand('sudo passwd')).not.toBeNull()
  })

  it('блокирует su и sudo su', () => {
    expect(isDangerousCommand('su -')).not.toBeNull()
    expect(isDangerousCommand('sudo su')).not.toBeNull()
  })

  it('блокирует запись в системные директории', () => {
    expect(isDangerousCommand('echo foo > /etc/passwd')).not.toBeNull()
    expect(isDangerousCommand('cat log > /var/log/auth.log')).not.toBeNull()
  })

  it('блокирует systemctl stop/disable', () => {
    expect(isDangerousCommand('systemctl stop ssh')).not.toBeNull()
    expect(isDangerousCommand('systemctl disable nginx')).not.toBeNull()
  })

  it('блокирует iptables -F', () => {
    expect(isDangerousCommand('iptables -F')).not.toBeNull()
  })

  it('блокирует chmod 777 /', () => {
    expect(isDangerousCommand('chmod 777 /')).not.toBeNull()
  })

  it('блокирует forkbomb', () => {
    expect(isDangerousCommand(':(){:|:&};:')).not.toBeNull()
  })

  it('пропускает обычные команды', () => {
    expect(isDangerousCommand('ls -la')).toBeNull()
    expect(isDangerousCommand('cd /opt/los && python script.py')).toBeNull()
    expect(isDangerousCommand('cat /etc/os-release')).toBeNull()  // read /etc допускается
    expect(isDangerousCommand('grep error /var/log/syslog')).toBeNull()  // read /var/log допускается
    expect(isDangerousCommand('source venv/bin/activate && python -c "print(1)"')).toBeNull()
    expect(isDangerousCommand('rm -rf /tmp/cache')).toBeNull()  // не корень
  })
})
