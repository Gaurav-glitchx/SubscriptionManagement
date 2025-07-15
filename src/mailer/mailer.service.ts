import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailerService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendMail({
    to,
    subject,
    text,
    html,
    attachments,
  }: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: any[];
  }) {
    this.logger.log(`Sending email to ${to} with subject "${subject}"`);
    try {
      const result = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
        html,
        attachments,
      });
      this.logger.log(
        `Email sent to ${to}: ${result.messageId || result.response}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${to}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
